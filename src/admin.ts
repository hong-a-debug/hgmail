// src/admin.ts
import { Env } from './types';
import { sha256 } from './utils';

// ============================================================
// 管理员设置
// ============================================================

/** 发件人前缀只允许地址里合法的字符，避免拼出非法/带注入的 From */
export function sanitizeSenderPrefix(prefix: string | null | undefined): string {
    const cleaned = String(prefix || '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    return cleaned.slice(0, 64) || 'noreply';
}

export async function getAdminSettings(env: Env) {
    const title = await env.EMAIL_USER.get('admin:title') || '📧 邮件管理';
    const senderPrefix = await env.EMAIL_USER.get('admin:sender_prefix') || 'noreply';
    const autoReply = await env.EMAIL_USER.get('admin:auto_reply') !== 'false';
    return { title, senderPrefix, autoReply };
}

export async function saveAdminSettings(
    env: Env,
    title?: string | null,
    senderPrefix?: string | null,
    autoReply?: boolean | null
) {
    if (title !== undefined && title !== null) {
        await env.EMAIL_USER.put('admin:title', String(title).slice(0, 200));
    }
    if (senderPrefix !== undefined && senderPrefix !== null) {
        await env.EMAIL_USER.put('admin:sender_prefix', sanitizeSenderPrefix(senderPrefix));
    }
    if (autoReply !== undefined && autoReply !== null) {
        await env.EMAIL_USER.put('admin:auto_reply', autoReply ? 'true' : 'false');
    }
}

// ============================================================
// 发件邮箱前缀
// ============================================================

export async function getSenderPrefix(env: Env): Promise<string> {
    return sanitizeSenderPrefix(await env.EMAIL_USER.get('admin:sender_prefix'));
}

export async function setSenderPrefix(env: Env, prefix: string) {
    await env.EMAIL_USER.put('admin:sender_prefix', sanitizeSenderPrefix(prefix));
}

// ============================================================
// 注册码
// ============================================================

export async function getRegCodePlain(env: Env): Promise<string | null> {
    return await env.EMAIL_USER.get('admin:regcode_plain');
}

export async function setRegCodePlain(env: Env, code: string) {
    await env.EMAIL_USER.put('admin:regcode_plain', code);
}

export async function getRegCodeHash(env: Env): Promise<string | null> {
    return await env.EMAIL_USER.get('admin:regcode_hash');
}

export async function setRegCodeHash(env: Env, regCodeHash: string) {
    await env.EMAIL_USER.put('admin:regcode_hash', regCodeHash);
}

/** 恒定时间比较，避免用 === 比对口令散列 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/** 校验注册码（大小写不敏感） */
export async function verifyRegCode(env: Env, input: string): Promise<boolean> {
    const stored = await env.EMAIL_USER.get('admin:regcode_hash');
    if (!stored) return false;
    const normalized = String(input || '').trim().toUpperCase();
    if (!normalized) return false;
    const hash = await sha256(normalized);
    return timingSafeEqual(stored, hash);
}

/** 生成新的注册码（用 CSPRNG，不用 Math.random） */
export async function generateRegCode(env: Env): Promise<string> {
    // 字母表长度 32，256 % 32 === 0，所以取模不会引入偏差；去掉易混淆的 I O 0 1
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(10));
    let code = '';
    for (const b of bytes) code += alphabet[b % alphabet.length];
    const hash = await sha256(code);
    await env.EMAIL_USER.put('admin:regcode_hash', hash);
    await env.EMAIL_USER.put('admin:regcode_plain', code);
    return code;
}
