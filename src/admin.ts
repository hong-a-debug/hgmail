// src/admin.ts
import { Env } from './types';
import { sha256 } from './utils';

// ============================================================
// 管理员设置（使用 EMAIL_USER KV）
// ============================================================

export async function getAdminSettings(env: Env) {
    const title = await env.EMAIL_USER.get('admin:title') || '📧 邮件管理';
    const sender = await env.EMAIL_USER.get('admin:sender') || `noreply@${env.DOMAIN}`;
    const hasRegCode = !!(await env.EMAIL_USER.get('admin:regcode_hash'));
    return { title, sender, hasRegCode };
}

export async function saveAdminSettings(
    env: Env,
    title: string,
    sender: string
) {
    if (title !== undefined) await env.EMAIL_USER.put('admin:title', title);
    if (sender !== undefined) await env.EMAIL_USER.put('admin:sender', sender);
}

// ============================================================
// 管理员密码（使用 EMAIL_USER KV）
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
// 注册码（使用 EMAIL_USER KV）
// ============================================================

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
    return code;
}
