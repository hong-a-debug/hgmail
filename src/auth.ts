// src/auth.ts
import { Env, User, Session } from './types';

// ============================================================
// 口令散列
// ------------------------------------------------------------
// 新格式：pbkdf2$迭代次数$salt(base64)$hash(base64)
// 旧格式：无盐的 sha256 十六进制（历史数据），校验通过后自动升级。
// ============================================================

const PBKDF2_ITERATIONS = 100_000;
const LEGACY_SHA256_RE = /^[0-9a-f]{64}$/;

function normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
}

function toBase64(bytes: Uint8Array): string {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
}

function fromBase64(str: string): Uint8Array {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2Bits(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' } as Pbkdf2Params,
        key,
        256
    );
    return new Uint8Array(bits);
}

/** 恒定时间字符串比较（避免用 === 比较口令散列） */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** 生成加盐 PBKDF2 散列 */
export async function hashPassword(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await pbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
    return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * 校验明文口令。
 * needsRehash=true 表示这条记录还是旧的无盐 sha256，调用方应顺手升级成 PBKDF2。
 */
export async function verifyPassword(
    password: string,
    stored: string | null | undefined
): Promise<{ ok: boolean; needsRehash: boolean }> {
    if (!stored || !password) return { ok: false, needsRehash: false };

    if (stored.startsWith('pbkdf2$')) {
        const parts = stored.split('$');
        if (parts.length !== 4) return { ok: false, needsRehash: false };
        const iterations = parseInt(parts[1], 10);
        if (!Number.isFinite(iterations) || iterations <= 0 || iterations > 1_000_000) {
            return { ok: false, needsRehash: false };
        }
        try {
            const salt = fromBase64(parts[2]);
            const bits = await pbkdf2Bits(password, salt, iterations);
            return { ok: timingSafeEqual(toBase64(bits), parts[3]), needsRehash: false };
        } catch {
            return { ok: false, needsRehash: false };
        }
    }

    // 兼容旧数据：sha256(明文)
    if (LEGACY_SHA256_RE.test(stored)) {
        const hex = await sha256Hex(password);
        return { ok: timingSafeEqual(hex, stored), needsRehash: true };
    }

    return { ok: false, needsRehash: false };
}

// ============================================================
// 用户管理
// ============================================================

export async function getUser(env: Env, email: string): Promise<User | null> {
    const key = normalizeEmail(email);
    if (!key) return null;
    const data = await env.EMAIL_USER.get(`user:${key}`);
    if (!data) return null;
    try {
        return JSON.parse(data) as User;
    } catch (e) {
        console.error(`用户记录损坏: ${key}`, e);
        return null;
    }
}

export async function createUser(
    env: Env,
    email: string,
    passwordHash: string,
    role: 'admin' | 'user' = 'user',
    confirmed = true
): Promise<User> {
    const key = normalizeEmail(email);
    const user: User = {
        email: key,
        password_hash: passwordHash,
        role,
        created_at: new Date().toISOString(),
        confirmed
    };
    await env.EMAIL_USER.put(`user:${key}`, JSON.stringify(user));
    return user;
}

/** 把某个用户标记为邮箱已确认 */
export async function markUserConfirmed(env: Env, email: string): Promise<boolean> {
    const user = await getUser(env, email);
    if (!user) return false;
    user.confirmed = true;
    await env.EMAIL_USER.put(`user:${normalizeEmail(email)}`, JSON.stringify(user));
    return true;
}

/** 邮箱是否已确认（老记录没有该字段，视为已确认） */
export function isUserConfirmed(user: User): boolean {
    return user.confirmed !== false;
}

export async function userExists(env: Env, email: string): Promise<boolean> {
    const key = normalizeEmail(email);
    if (!key) return false;
    const data = await env.EMAIL_USER.get(`user:${key}`);
    return !!data;
}

/** 修改某个用户的口令散列（管理员面板与用户自助改密共用） */
export async function updateUserPassword(env: Env, email: string, passwordHash: string): Promise<boolean> {
    const user = await getUser(env, email);
    if (!user) return false;
    user.password_hash = passwordHash;
    await env.EMAIL_USER.put(`user:${normalizeEmail(email)}`, JSON.stringify(user));
    return true;
}

export async function updateUserRole(env: Env, email: string, role: 'admin' | 'user'): Promise<boolean> {
    const user = await getUser(env, email);
    if (!user) return false;
    user.role = role;
    await env.EMAIL_USER.put(`user:${normalizeEmail(email)}`, JSON.stringify(user));
    return true;
}

// ============================================================
// 会话管理
// ============================================================

export async function createSession(env: Env, email: string, role: 'admin' | 'user'): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session: Session = {
        email: normalizeEmail(email),
        role,
        created_at: new Date().toISOString()
    };
    await env.EMAIL_USER.put(`session:${sessionId}`, JSON.stringify(session), {
        expirationTtl: 60 * 60 * 24 * 7 // 7天过期
    });
    return sessionId;
}

export async function getSession(env: Env, sessionId: string): Promise<Session | null> {
    if (!sessionId) return null;
    const data = await env.EMAIL_USER.get(`session:${sessionId}`);
    if (!data) return null;
    try {
        const session = JSON.parse(data) as Session;
        if (!session || typeof session.email !== 'string') return null;
        session.email = normalizeEmail(session.email);
        return session;
    } catch (e) {
        console.error('会话记录损坏:', e);
        return null;
    }
}

export async function destroySession(env: Env, sessionId: string) {
    if (!sessionId) return;
    await env.EMAIL_USER.delete(`session:${sessionId}`);
}

// ============================================================
// 管理员存在检查
// ============================================================

export async function hasAdmin(env: Env): Promise<boolean> {
    const adminExists = await env.EMAIL_USER.get('_admin_exists');
    return adminExists === 'true';
}

export async function setAdminExists(env: Env, exists: boolean) {
    await env.EMAIL_USER.put('_admin_exists', exists ? 'true' : 'false');
}
