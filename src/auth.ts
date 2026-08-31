// src/auth.ts
import { Env, User, Session } from './types';
import { sha256 } from './utils';

// ============================================================
// 用户管理
// ============================================================

export async function getUser(env: Env, email: string): Promise<User | null> {
    const data = await env.EMAIL_USER.get(`user:${email}`);
    if (!data) return null;
    return JSON.parse(data);
}

export async function createUser(
    env: Env,
    email: string,
    passwordHash: string,
    role: 'admin' | 'user' = 'user'
): Promise<User> {
    const user: User = {
        email,
        password_hash: passwordHash,
        role,
        created_at: new Date().toISOString()
    };
    await env.EMAIL_USER.put(`user:${email}`, JSON.stringify(user));
    return user;
}

export async function userExists(env: Env, email: string): Promise<boolean> {
    const data = await env.EMAIL_USER.get(`user:${email}`);
    return !!data;
}

// ============================================================
// 会话管理（Session）
// ============================================================

export async function createSession(env: Env, email: string, role: 'admin' | 'user'): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session: Session = { email, role, created_at: new Date().toISOString() };
    await env.EMAIL_USER.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 7 });
    return sessionId;
}

export async function getSession(env: Env, sessionId: string): Promise<Session | null> {
    const data = await env.EMAIL_USER.get(`session:${sessionId}`);
    if (!data) return null;
    return JSON.parse(data);
}

export async function destroySession(env: Env, sessionId: string) {
    await env.EMAIL_USER.delete(`session:${sessionId}`);
}

// ============================================================
// API Key 管理
// ============================================================

export async function createApiKey(env: Env, email: string, role: 'admin' | 'user'): Promise<string> {
    const apiKey = 'sk_' + crypto.randomUUID().replace(/-/g, '');
    const keyData = { email, role, created_at: new Date().toISOString() };
    await env.EMAIL_USER.put(`api_key:${apiKey}`, JSON.stringify(keyData), { expirationTtl: 60 * 60 * 24 * 365 });
    return apiKey;
}

export async function getApiKey(env: Env, apiKey: string): Promise<{ email: string; role: 'admin' | 'user' } | null> {
    const data = await env.EMAIL_USER.get(`api_key:${apiKey}`);
    if (!data) return null;
    return JSON.parse(data);
}

export async function deleteApiKey(env: Env, apiKey: string) {
    await env.EMAIL_USER.delete(`api_key:${apiKey}`);
}

export async function listApiKeys(env: Env, email: string): Promise<string[]> {
    const listKey = `api_keys:${email}`;
    const data = await env.EMAIL_USER.get(listKey);
    if (!data) return [];
    return JSON.parse(data);
}

export async function addApiKeyToList(env: Env, email: string, apiKey: string) {
    const listKey = `api_keys:${email}`;
    const data = await env.EMAIL_USER.get(listKey);
    const keys: string[] = data ? JSON.parse(data) : [];
    keys.push(apiKey);
    await env.EMAIL_USER.put(listKey, JSON.stringify(keys));
}

export async function removeApiKeyFromList(env: Env, email: string, apiKey: string) {
    const listKey = `api_keys:${email}`;
    const data = await env.EMAIL_USER.get(listKey);
    if (!data) return;
    const keys: string[] = JSON.parse(data);
    const filtered = keys.filter(k => k !== apiKey);
    await env.EMAIL_USER.put(listKey, JSON.stringify(filtered));
}

// ============================================================
// 统一的认证入口（Cookie + API Key）
// ============================================================

export async function getSessionFromRequest(env: Env, request: Request): Promise<Session | null> {
    // 1. 优先检查 Cookie（网页访问）
    const cookie = request.headers.get('Cookie') || '';
    const sessionId = cookie.match(/session=([^;]+)/)?.[1];
    if (sessionId) {
        const session = await getSession(env, sessionId);
        if (session) return session;
    }
    
    // 2. 检查 Authorization Header（API 调用）
    const authHeader = request.headers.get('Authorization') || '';
    const apiKey = authHeader.replace(/^Bearer\s+/i, '');
    if (apiKey && apiKey.startsWith('sk_')) {
        const keyData = await getApiKey(env, apiKey);
        if (keyData) {
            return { email: keyData.email, role: keyData.role, created_at: '' };
        }
    }
    
    return null;
}

// ============================================================
// 检查管理员是否存在
// ============================================================

export async function hasAdmin(env: Env): Promise<boolean> {
    const adminExists = await env.EMAIL_USER.get('_admin_exists');
    return adminExists === 'true';
}

export async function setAdminExists(env: Env, exists: boolean) {
    await env.EMAIL_USER.put('_admin_exists', exists ? 'true' : 'false');
}
