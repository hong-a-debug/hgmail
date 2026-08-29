import { Env } from './types';
import { sha256 } from './utils';

// ============================================================
// 管理员设置
// ============================================================

export async function getAdminSettings(env: Env) {
    const title = await env.EMAIL_USER.get('admin:title') || '📧 邮件管理';
    const senderPrefix = await env.EMAIL_USER.get('admin:sender_prefix') || 'noreply';
    return { title, senderPrefix };
}

export async function saveAdminSettings(env: Env, title: string, senderPrefix: string) {
    if (title !== undefined) await env.EMAIL_USER.put('admin:title', title);
    if (senderPrefix !== undefined) await env.EMAIL_USER.put('admin:sender_prefix', senderPrefix);
}

// ============================================================
// 发件邮箱前缀（独立读写）
// ============================================================

export async function getSenderPrefix(env: Env): Promise<string> {
    return await env.EMAIL_USER.get('admin:sender_prefix') || 'noreply';
}

export async function setSenderPrefix(env: Env, prefix: string) {
    await env.EMAIL_USER.put('admin:sender_prefix', prefix);
}

// ============================================================
// 管理员密码
// ============================================================

export async function getAdminPasswordHash(env: Env): Promise<string | null> {
    return await env.EMAIL_USER.get('admin:password_hash');
}

export async function setAdminPasswordHash(env: Env, passwordHash: string) {
    await env.EMAIL_USER.put('admin:password_hash', passwordHash);
}

export async function verifyAdminPassword(env: Env, inputHash: string): Promise<boolean> {
    const stored = await env.EMAIL_USER.get('admin:password_hash');
    if (!stored) return false;
    return stored === inputHash;
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

export async function verifyRegCode(env: Env, inputHash: string): Promise<boolean> {
    const stored = await env.EMAIL_USER.get('admin:regcode_hash');
    if (!stored) return false;
    return stored === inputHash;
}

export async function generateRegCode(env: Env): Promise<string> {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    const hash = await sha256(code);
    await env.EMAIL_USER.put('admin:regcode_hash', hash);
    await env.EMAIL_USER.put('admin:regcode_plain', code);
    return code;
}
