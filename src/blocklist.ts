// src/blocklist.ts
import { Env } from './types';

// ============================================================
// 封禁列表管理
// ============================================================
//
// KV 键设计：
//   block:email:<address>  -> { reason, created_at, created_by }
//   block:domain:<domain>  -> { reason, created_at, created_by }
//
// 分开存是为了：
//   1. 便于按前缀列出（block:email: / block:domain:）
//   2. 精确匹配邮箱和域名，避免子串误伤（比如封禁 example.com
//      不应该连带封禁 notexample.com）
// ============================================================

export interface BlockEntry {
    /** 被封禁的邮箱地址或域名（已归一化为小写） */
    target: string;
    /** email 或 domain */
    type: 'email' | 'domain';
    /** 封禁原因（可选，便于日后审计） */
    reason: string;
    /** ISO 时间戳 */
    created_at: string;
    /** 操作人（管理员邮箱） */
    created_by: string;
}

/** 封禁列表上限，防止 KV 被塞爆 / 前端一次渲染过多 */
export const MAX_BLOCK_ENTRIES = 2000;

/** 邮箱归一化：去空白 + 转小写 */
function normalize(value: string): string {
    return String(value || '').trim().toLowerCase();
}

/** 从 "名字 <a@b.com>" 或 "a@b.com" 里取出纯地址 */
function extractAddress(input: string): string {
    const value = normalize(input);
    if (!value) return '';
    const angled = value.match(/<([^>]+)>/);
    const addr = (angled ? angled[1] : value).trim();
    if (!addr || !addr.includes('@') || /\s/.test(addr)) return '';
    return addr;
}

/** 校验域名格式（用于封禁域名时） */
export function isValidDomain(domain: string): boolean {
    const d = normalize(domain).replace(/^@/, '');
    if (!d || d.length > 190) return false;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);
}

/** 判断一个输入是邮箱还是域名 */
export function detectTargetType(input: string): 'email' | 'domain' | null {
    const value = normalize(input).replace(/^@/, '');
    if (!value) return null;
    if (value.includes('@')) {
        const addr = extractAddress(value);
        if (!addr) return null;
        return /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(addr)
            ? 'email'
            : null;
    }
    return isValidDomain(value) ? 'domain' : null;
}

/** 归一化目标：邮箱取纯地址，域名去掉开头的 @ */
export function normalizeTarget(input: string, type: 'email' | 'domain'): string {
    if (type === 'email') return extractAddress(input);
    return normalize(input).replace(/^@/, '');
}

function emailKey(address: string): string {
    return `block:email:${address}`;
}

function domainKey(domain: string): string {
    return `block:domain:${domain}`;
}

function safeParse(raw: string): BlockEntry | null {
    try {
        return JSON.parse(raw) as BlockEntry;
    } catch {
        return null;
    }
}

/**
 * 检查某个发件人是否被封禁。
 * 匹配顺序：精确邮箱 -> 完整域名 -> 父域名（封禁根域会连带封禁所有子域）
 *
 * 例如封禁 example.com 后，mail.example.com 也会被拦；
 * 但封禁 mail.example.com 不会影响 example.com。
 *
 * 任何 KV 读取异常都返回 blocked: false（放行）：
 * 封禁是"阻断"功能，宁可漏拦也不应因 KV 抖动误杀正常邮件。
 */
export async function isBlocked(
    env: Env,
    fromAddress: string
): Promise<{ blocked: boolean; matched?: string; reason?: string }> {
    const addr = extractAddress(fromAddress);
    if (!addr) return { blocked: false };

    try {
        // 1. 精确邮箱
        const emailHit = await env.EMAIL_USER.get(emailKey(addr));
        if (emailHit) {
            const entry = safeParse(emailHit);
            return { blocked: true, matched: addr, reason: entry?.reason || '' };
        }

        // 2. 域名：从完整域名开始逐级向上找
        const parts = addr.split('@')[1]?.split('.').filter(Boolean) || [];
        for (let i = 0; i < parts.length - 1; i++) {
            const domain = parts.slice(i).join('.');
            const hit = await env.EMAIL_USER.get(domainKey(domain));
            if (hit) {
                const entry = safeParse(hit);
                return { blocked: true, matched: domain, reason: entry?.reason || '' };
            }
        }
    } catch (e) {
        console.error('封禁检查失败，按未封禁处理:', e);
        return { blocked: false };
    }

    return { blocked: false };
}

/** 添加一条封禁记录 */
export async function addBlock(
    env: Env,
    input: string,
    reason: string,
    createdBy: string
): Promise<{ success: boolean; error?: string; entry?: BlockEntry }> {
    const type = detectTargetType(input);
    if (!type) {
        return { success: false, error: '格式不正确，请输入邮箱地址或域名' };
    }

    const target = normalizeTarget(input, type);
    if (!target) {
        return { success: false, error: '无法解析目标' };
    }

    // 数量上限检查
    try {
        const [emails, domains] = await Promise.all([
            env.EMAIL_USER.list({ prefix: 'block:email:', limit: MAX_BLOCK_ENTRIES + 1 }),
            env.EMAIL_USER.list({ prefix: 'block:domain:', limit: MAX_BLOCK_ENTRIES + 1 }),
        ]);
        if (emails.keys.length + domains.keys.length >= MAX_BLOCK_ENTRIES) {
            return { success: false, error: `封禁列表已达上限（${MAX_BLOCK_ENTRIES} 条），请先清理` };
        }
    } catch (e) {
        console.error('检查封禁列表数量失败:', e);
    }

    const entry: BlockEntry = {
        target,
        type,
        reason: String(reason || '').slice(0, 500),
        created_at: new Date().toISOString(),
        created_by: String(createdBy || '').slice(0, 254),
    };

    const key = type === 'email' ? emailKey(target) : domainKey(target);
    await env.EMAIL_USER.put(key, JSON.stringify(entry));
    return { success: true, entry };
}

/** 删除一条封禁记录 */
export async function removeBlock(
    env: Env,
    input: string
): Promise<{ success: boolean; error?: string }> {
    const type = detectTargetType(input);
    if (!type) return { success: false, error: '格式不正确' };
    const target = normalizeTarget(input, type);
    const key = type === 'email' ? emailKey(target) : domainKey(target);
    await env.EMAIL_USER.delete(key);
    return { success: true };
}

/** 列出所有封禁记录（按添加时间倒序） */
export async function listBlocks(env: Env): Promise<BlockEntry[]> {
    const out: BlockEntry[] = [];
    let cursor: string | undefined;
    do {
        const listed = await env.EMAIL_USER.list({
            prefix: 'block:',
            cursor,
            limit: 1000,
        });
        for (const k of listed.keys) {
            const raw = await env.EMAIL_USER.get(k.name);
            if (!raw) continue;
            const entry = safeParse(raw);
            if (entry && entry.target && entry.type) out.push(entry);
        }
        cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor);

    out.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return out;
}
