import { Env, StoredEmail } from './types';
import { parseEmail } from './email-parser';
import { sendAutoReply, sendEmail } from './resend-client';
import { saveAttachments, getAttachment, deleteAttachments } from './attachment';
import {
    getUser,
    createUser,
    userExists,
    createSession,
    getSession,
    destroySession,
    setAdminExists,
    hashPassword,
    verifyPassword,
    updateUserPassword,
} from './auth';
import {
    verifyRegCode,
    generateRegCode,
    getAdminSettings,
    saveAdminSettings,
    sanitizeSenderPrefix,
} from './admin';

import template from './template.html';

const HTML_TEMPLATE = template;

// ============================================================
// 全局常量
// ============================================================
// 邮件在 KV 中的保留时长（秒）。所有写入该 key 的地方都必须带上，
// 否则 KV 的过期属性会被无 TTL 的 put 覆盖掉，邮件变成永不过期。
const MAIL_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天
// 列表索引最多保留多少封
const MAX_INDEXED_MAILS = 500;
// 列表接口一次返回多少封（只返回摘要，正文走 /mail/:id）
const MAIL_LIST_LIMIT = 50;

// 安全响应头（所有 HTML / JS / JSON 响应统一附加）
const SECURITY_HEADERS: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
        "default-src 'self'",
        // 邮件正文里的远程图片（logo、签名图）保持可见；
        // 想彻底挡掉跟踪像素的话，把 https: 去掉只留 'self' data: blob:
        "img-src 'self' data: blob: https:",
        "style-src 'self' 'unsafe-inline'",
        // 注意：这里必须保留 'unsafe-inline'。
        // 本站挂在 Cloudflare 后面，边缘会往每个 HTML 响应里注入一段内联脚本
        // （window.__CF$cv$params = {...}，即 Bot Management / JS Detections），
        // 而且它的内容每次请求都不同（含随机 r 值），无法用哈希或 nonce 放行。
        // 若在 Cloudflare 后台关掉 JS Detections 与 Web Analytics，即可删掉
        // 'unsafe-inline' 和下面两个 Cloudflare 域名，恢复严格的 script-src 'self'。
        "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
        "worker-src 'self'",
        "connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'none'",
        "frame-ancestors 'none'"
    ].join('; ')
};

/** 给任意响应附加安全响应头（不覆盖已有的同名头，并显式保留 Set-Cookie） */
function withSecurityHeaders(res: Response): Response {
    const headers = new Headers(res.headers);
    const setCookie = res.headers.get('Set-Cookie');
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
        if (!headers.has(k)) headers.set(k, v);
    }
    // Set-Cookie 在部分实现里不会被 Headers 迭代器带出，显式补回
    if (setCookie) headers.set('Set-Cookie', setCookie);
    return new Response(res.body, {
        status: res.status,
        statusText: res.statusText,
        headers
    });
}

/** 生成会话 Cookie（HttpOnly，前端 JS 读不到，只能由服务端下发/清除） */
function sessionCookie(sessionId: string, maxAgeSeconds: number): string {
    const parts = [
        `session=${sessionId}`,
        'Path=/',
        'HttpOnly',
        'Secure',
        'SameSite=Lax',
        `Max-Age=${maxAgeSeconds}`
    ];
    return parts.join('; ');
}

/** 从请求头里安全地取会话 ID（锚定到 cookie 名，避免匹配到 xsession= 之类） */
function readSessionId(request: Request): string | null {
    const cookie = request.headers.get('Cookie') || '';
    const match = cookie.match(/(?:^|;\s*)session=([^;]+)/);
    return match ? match[1] : null;
}

/** 邮箱统一归一化：去空白 + 转小写 */
function normalizeEmail(email: string | null | undefined): string {
    return String(email || '').trim().toLowerCase();
}

/**
 * 邮箱格式校验。
 * 关键是要拒绝 `:` —— KV 键是 `user:${email}` 与 `user:${email}:list`，
 * 以前注册 `a:list` 会正好写到用户 a 的邮件列表键上，破坏别人的数据。
 */
function isValidEmailAddress(email: string): boolean {
    if (!email || email.length > 254) return false;
    return /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/.test(email);
}

/** 路径段解码，非法转义返回 null 而不是抛异常（否则 /mail/% 直接 500） */
function safeDecode(value: string): string | null {
    try {
        return decodeURIComponent(value);
    } catch {
        return null;
    }
}

// ============================================================
// 通用工具
// ============================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 解析 KV 里的 JSON，失败时回退而不是抛异常（以前一旦数据异常整个接口 500） */
function safeJsonParse<T>(raw: string | null, fallback: T): T {
    if (raw === null || raw === undefined || raw === '') return fallback;
    try {
        return JSON.parse(raw) as T;
    } catch (e) {
        console.error('JSON 解析失败，已回退到默认值:', raw.slice(0, 120), e);
        return fallback;
    }
}

/** 从 "名字 <a@b.com>" 或 "a@b.com" 里取出纯地址并归一化 */
function extractAddress(input: unknown): string {
    const value = normalizeEmail(typeof input === 'string' ? input : '');
    if (!value) return '';
    const angled = value.match(/<([^>]+)>/);
    const addr = (angled ? angled[1] : value).trim();
    if (!addr || !addr.includes('@') || /\s/.test(addr)) return '';
    return addr;
}

/** 会话是否有权访问某封邮件：管理员全权，普通用户必须是收件人之一 */
function canAccessMail(session: { email: string; role: string }, mail: StoredEmail): boolean {
    if (session.role === 'admin') return true;
    const email = normalizeEmail(session.email);
    if (!email) return false;
    if (normalizeEmail(mail.to) === email) return true;
    if (Array.isArray(mail.recipients) && mail.recipients.some(r => normalizeEmail(r) === email)) return true;
    return false;
}

/** 列表接口用的邮件摘要（不含正文，避免一次返回几十封完整 HTML） */
function mailSummary(mail: StoredEmail) {
    return {
        id: mail.id,
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        timestamp: mail.timestamp,
        status: mail.status,
        attachmentCount: Array.isArray(mail.attachments) ? mail.attachments.length : 0,
        snippet: String(mail.text || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    };
}

/**
 * 把 HTML 正文里的 `cid:xxx` 换成可访问的附件地址。
 * 邮件的内嵌图片（logo、签名图）都以 cid: 引用，不重写的话详情页全是裂图。
 * 用 ?inline=1 让下载路由以内联方式返回，否则 Content-Disposition: attachment 会让 <img> 加载不到。
 */
function rewriteCidUrls(html: string | undefined, attachments: { key: string; content_id?: string }[]): string | undefined {
    if (!html || !attachments || attachments.length === 0) return html;
    let out = html;
    for (const att of attachments) {
        const cid = (att.content_id || '').trim();
        if (!cid) continue;
        const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const url = `/attachments/${att.key}?inline=1`;
        out = out.replace(new RegExp(`cid:${escaped}`, 'gi'), url);
    }
    return out;
}

/** 允许的 Web Push 服务端点（防止把订阅 endpoint 指向任意地址做盲 SSRF） */
const ALLOWED_PUSH_HOSTS = [
    'fcm.googleapis.com',
    'updates.push.services.mozilla.com',
    'push.services.mozilla.com',
    'notify.windows.com',
    'push.apple.com',
    'web.push.apple.com'
];

function isAllowedPushEndpoint(endpoint: string): boolean {
    if (!endpoint) return false;
    try {
        const url = new URL(endpoint);
        if (url.protocol !== 'https:') return false;
        const host = url.hostname.toLowerCase();
        return ALLOWED_PUSH_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
    } catch {
        return false;
    }
}

/** 附件下载响应：默认强制 attachment + nosniff；inline=1 时只对图片/音视频内联返回 */
function attachmentResponse(
    attachment: { content: ArrayBuffer; contentType: string; filename: string },
    inline = false
): Response {
    let filename = attachment.filename;
    try { filename = decodeURIComponent(filename); } catch { /* ignore */ }
    const rawType = attachment.contentType || '';
    const contentType = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/i.test(rawType)
        ? rawType
        : 'application/octet-stream';
    // 只允许图片/音视频内联，text/html、image/svg+xml 等一律走 attachment 下载
    const safeInline = inline
        && /^(image\/(?!svg)|audio\/|video\/)/i.test(contentType);
    return new Response(attachment.content, {
        headers: {
            'Content-Type': contentType,
            'Content-Disposition': `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'private, max-age=3600'
        },
    });
}

/**
 * 收件人集合 = SMTP 信封地址 + To/Cc 头部地址，归一化去重。
 * 信封地址是投递的权威来源（catch-all / BCC 只有它才准），头部用于补齐多个收件人。
 */
function normalizeRecipients(envelopeTo: unknown, headerRecipients?: string[] | null): string[] {
    const out = new Set<string>();
    for (const part of String(envelopeTo || '').split(',')) {
        const addr = extractAddress(part);
        if (addr) out.add(addr);
    }
    for (const part of headerRecipients || []) {
        const addr = extractAddress(part);
        if (addr) out.add(addr);
    }
    return Array.from(out);
}

/**
 * 把一个邮件 ID 追加进索引数组。
 * KV 对同一个 key 有「每秒 1 次写」的限制，突发收信时会 429，
 * 以前这个异常会被外层 catch 吞掉 —— 邮件正文已入库但索引没写，邮件在列表里永久消失。
 */
async function appendToIndex(
    env: Env,
    kv: KVNamespace,
    key: string,
    id: string,
    max: number
): Promise<void> {
    let stale: string[] = [];
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const raw = await kv.get(key);
            let ids = safeJsonParse<string[]>(raw, []);
            if (!Array.isArray(ids)) ids = [];
            ids = ids.filter(x => typeof x === 'string' && x);
            if (!ids.includes(id)) ids.push(id);
            if (ids.length > max) {
                stale = ids.slice(0, ids.length - max);
                ids = ids.slice(-max);
            }
            await kv.put(key, JSON.stringify(ids));
            break;
        } catch (e) {
            if (attempt === 4) {
                console.error(`❌ 索引写入最终失败，邮件 ${id} 可能不出现在列表里: ${key}`, e);
                return;
            }
            console.warn(`索引写入失败(${key})，第 ${attempt} 次重试:`, e);
            await sleep(150 * attempt * attempt);
        }
    }

    // 只有全局索引被淘汰时才删数据，且要连 R2 附件一起删（否则附件永远留着）
    if (stale.length > 0 && key === '_mail_ids') {
        for (const oldId of stale) {
            try {
                const data = await env.EMAIL.get(oldId);
                if (data) await deleteAttachments(env, oldId);
                await env.EMAIL.delete(oldId);
            } catch (e) {
                console.error(`清理过期邮件失败: ${oldId}`, e);
            }
        }
    }
}

/** 自动回复前的回环 / backscatter 防护 */
function shouldSkipAutoReply(
    message: any,
    parsed: { from: string },
    env: Env
): { skip: boolean; reason?: string } {
    const headers: Headers | undefined = message?.headers;
    const autoSubmitted = headers?.get('Auto-Submitted') || '';
    if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
        return { skip: true, reason: `Auto-Submitted: ${autoSubmitted}` };
    }

    const precedence = (headers?.get('Precedence') || '').trim().toLowerCase();
    if (precedence === 'bulk' || precedence === 'list' || precedence === 'junk') {
        return { skip: true, reason: `Precedence: ${precedence}` };
    }

    if (typeof message?.from === 'string' && message.from.trim() === '') {
        return { skip: true, reason: '空发件人（很可能是退信）' };
    }

    const fromAddr = extractAddress(parsed.from);
    if (!fromAddr) return { skip: true, reason: '发件人地址无法解析' };

    const domain = normalizeEmail(env.DOMAIN);
    const fromDomain = fromAddr.split('@')[1] || '';
    if (domain && fromDomain === domain) {
        return { skip: true, reason: '发件人为本域，避免两台服务器互相回环' };
    }

    const local = fromAddr.split('@')[0];
    if (['mailer-daemon', 'postmaster', 'noreply', 'no-reply', 'donotreply', 'abuse'].includes(local)) {
        return { skip: true, reason: `发件人是无人值守地址 ${local}` };
    }

    return { skip: false };
}

// ============================================================
// 发送 Web Push 通知
// ============================================================
async function sendPushNotification(
    env: Env,
    subscription: any,
    title: string,
    from: string
): Promise<void> {
    const webpush = await import('web-push');
    webpush.default.setVapidDetails(
        `mailto:admin@${env.DOMAIN}`,
        env.VAPID_PUBLIC_KEY,
        env.VAPID_PRIVATE_KEY
    );
    const payload = JSON.stringify({
        title: '📧 新邮件',
        body: `${from}: ${title}`,
        url: '/'
    });
    await webpush.default.sendNotification(subscription, payload, {
        TTL: 60 * 60
    });
}

// ============================================================
// PWA 图标（PNG）
// ============================================================
function getIconPng(base64: string): Response {
    const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    return new Response(binary, {
        headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400'
        },
    });
}

// ============================================================
// Worker 主入口
// ============================================================
const worker = {
    async email(message: any, env: Env, ctx: ExecutionContext) {
        console.log(`📨 收到邮件: from=${message.from}, to=${message.to}`);

        try {
            const raw = await new Response(message.raw).arrayBuffer();
            const parsed = await parseEmail(raw);

            const messageId = crypto.randomUUID();

            if (parsed.isSpam) {
                // 这里刻意不用 message.setReject()：拒收会把退信发回给（通常是被伪造的）发件人，
                // 等于自己制造 backscatter —— 那正是本文件里自动回复要防的东西。
                // 改为「隔离」：正文入库（7 天后自动过期）、不打进任何人的索引、附件不落 R2。
                const spamRecipients = normalizeRecipients(message.to, parsed.recipients);
                const spamData: StoredEmail = {
                    id: messageId,
                    from: parsed.from,
                    to: spamRecipients[0] || normalizeEmail(parsed.to) || 'unknown',
                    recipients: [],
                    subject: parsed.subject,
                    timestamp: new Date().toISOString(),
                    text: parsed.text,
                    html: parsed.html,
                    attachments: [],
                    status: 'spam',
                };
                try {
                    await env.EMAIL.put(`spam:${messageId}`, JSON.stringify(spamData), {
                        expirationTtl: 7 * 24 * 60 * 60
                    });
                    console.log(`🚫 垃圾邮件已隔离: from=${parsed.from}, subject=${parsed.subject}`);
                } catch (e) {
                    console.error('隔离垃圾邮件失败:', e);
                }
                return;
            }

            const attachments = await saveAttachments(env, parsed.attachments, messageId);

            if (parsed.hasScript) {
                console.log(`📝 邮件含 <script> 标签，已移除标签及内容: from=${parsed.from}`);
            }

            // 收件人集合：SMTP 信封地址 + To/Cc 头部，归一化后去重。
            // 以前只取头部第一个地址，导致多人收件时其他人都看不到这封信。
            const recipients = normalizeRecipients(message.to, parsed.recipients);

            // 把正文里 cid: 引用的内嵌图片重写成本站地址，否则所有内联图片（logo、签名）都是裂图。
            const displayHtml = rewriteCidUrls(parsed.html, attachments);

            const emailData: StoredEmail = {
                id: messageId,
                from: parsed.from,
                to: recipients[0] || normalizeEmail(parsed.to) || 'unknown',
                recipients,
                subject: parsed.subject,
                timestamp: new Date().toISOString(),
                text: parsed.text,
                html: displayHtml,
                attachments: attachments,
                status: 'received',
            };

            await env.EMAIL.put(messageId, JSON.stringify(emailData), { expirationTtl: MAIL_TTL_SECONDS });

            // 全局邮件索引（带退避重试 / 淘汰清理）
            await appendToIndex(env, env.EMAIL, '_mail_ids', messageId, MAX_INDEXED_MAILS);

            // 用户邮件列表
            for (const recipient of recipients) {
                await appendToIndex(env, env.EMAIL_USER, `user:${recipient}:list`, messageId, MAX_INDEXED_MAILS);
            }

            // 推送通知
            for (const recipient of recipients) {
                const subJson = await env.EMAIL_USER.get(`push:${recipient}`);
                if (!subJson) continue;
                try {
                    const subscription = JSON.parse(subJson);
                    await sendPushNotification(
                        env,
                        subscription,
                        parsed.subject || '(无主题)',
                        parsed.from
                    );
                } catch (e: any) {
                    console.error('推送失败:', e);
                    // 以前用 String(e).includes('410') 判断，既会漏判也会误判
                    const status = e?.statusCode ?? e?.status;
                    if (status === 404 || status === 410) {
                        await env.EMAIL_USER.delete(`push:${recipient}`);
                        await env.EMAIL_USER.put(`push_failed:${recipient}`, new Date().toISOString());
                    }
                }
            }

            // 自动回复
            const autoReplyEnabled = await env.EMAIL_USER.get('admin:auto_reply') !== 'false';
            const replyGuard = shouldSkipAutoReply(message, parsed, env);
            if (env.RESEND_API_KEY && autoReplyEnabled && !replyGuard.skip) {
                // 用 sanitizeSenderPrefix 兜住历史遗留的脏值，避免拼出非法 From
                const prefix = sanitizeSenderPrefix(await env.EMAIL_USER.get('admin:sender_prefix'));
                const sender = `${prefix}@${env.DOMAIN}`;
                await sendAutoReply(env.RESEND_API_KEY, sender, parsed.from, parsed.subject);
                const updated = { ...emailData, status: 'replied' as const };
                await env.EMAIL.put(messageId, JSON.stringify(updated), { expirationTtl: MAIL_TTL_SECONDS });
                console.log('✅ 邮件已存储并自动回复');
            } else {
                const why = replyGuard.reason ? `，跳过自动回复: ${replyGuard.reason}` : '';
                console.log(`✅ 邮件已存储（自动回复: ${autoReplyEnabled ? '已配置 Resend' : '已关闭'}${why}）`);
            }
        } catch (error) {
            console.error('❌ 处理邮件失败:', error);
        }
    },

    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        const path = url.pathname;

        async function getSessionFromCookie() {
            const sessionId = readSessionId(request);
            if (!sessionId) return null;
            return await getSession(env, sessionId);
        }

        // ============================================================
        // 未登录：获取公开信息（标题、域名）
        // ============================================================
        if (path === '/no-login/info') {
            const settings = await getAdminSettings(env);
            return Response.json({
                account: env.ADMIN_ACCOUNT || 'admin',
                domain: env.DOMAIN,
                title: settings.title || '📧 邮件管理',
                isLoggedIn: false,
            });
        }

        // ============================================================
        // 已登录：获取用户信息 + 标题 + 域名
        // ============================================================
        if (path === '/user/info') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ success: false, error: '未登录' }, { status: 401 });
            }

            const settings = await getAdminSettings(env);

            return Response.json({
                success: true,
                account: env.ADMIN_ACCOUNT || 'admin',
                domain: env.DOMAIN,
                title: settings.title || '📧 邮件管理',
                isLoggedIn: true,
                resendConfigured: !!env.RESEND_API_KEY,
                user: {
                    email: session.email,
                    role: session.role,
                },
            });
        }

        // ============================================================
        // 管理员：获取用户信息 + 管理员设置
        // ============================================================
        if (path === '/admin/info') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ success: false, error: '未登录' }, { status: 401 });
            }
            if (session.role !== 'admin') {
                return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });
            }

            const settings = await getAdminSettings(env);
            const regCodePlain = await env.EMAIL_USER.get('admin:regcode_plain');

            return Response.json({
                success: true,
                account: env.ADMIN_ACCOUNT || 'admin',
                domain: env.DOMAIN,
                title: settings.title || '📧 邮件管理',
                isLoggedIn: true,
                resendConfigured: !!env.RESEND_API_KEY,
                user: {
                    email: session.email,
                    role: session.role,
                },
                settings: {
                    title: settings.title || '📧 邮件管理',
                    senderPrefix: settings.senderPrefix || 'noreply',
                    regCode: regCodePlain || '暂无注册码',
                    autoReply: settings.autoReply !== undefined ? settings.autoReply : true,
                },
            });
        }

        // ============================================================
        // 获取域名
        // ============================================================
        if (path === '/admin/domain') {
            return Response.json({ domain: env.DOMAIN });
        }

        // ============================================================
        // 检查是否有管理员
        // ============================================================
        if (path === '/admin/check') {
            const adminExists = await env.EMAIL_USER.get('_admin_exists');
            return Response.json({ hasAdmin: adminExists === 'true' });
        }

        // ============================================================
        // 获取管理员账号
        // ============================================================
        if (path === '/admin/account') {
            return Response.json({ account: env.ADMIN_ACCOUNT || 'admin' });
        }

        // ============================================================
        // 注册
        // ============================================================
        if (path === '/register' && request.method === 'POST') {
            try {
                const body = await request.json() as { email?: string; password?: string; regCode?: string };
                const email = normalizeEmail(body.email);
                const password = String(body.password || '');
                const regCode = String(body.regCode || '').trim();

                if (!isValidEmailAddress(email)) {
                    return Response.json({ success: false, error: '邮箱格式不正确' }, { status: 400 });
                }
                if (password.length < 6) {
                    return Response.json({ success: false, error: '密码至少 6 位' }, { status: 400 });
                }

                const hasAdminUser = await env.EMAIL_USER.get('_admin_exists') === 'true';

                if (hasAdminUser) {
                    if (!regCode) return Response.json({ success: false, error: '请输入注册码' }, { status: 400 });
                    if (!await verifyRegCode(env, regCode)) {
                        return Response.json({ success: false, error: '注册码错误' }, { status: 400 });
                    }
                }

                if (await userExists(env, email)) {
                    return Response.json({ success: false, error: '该邮箱已注册' }, { status: 400 });
                }

                const role = hasAdminUser ? 'user' : 'admin';
                await createUser(env, email, await hashPassword(password), role);

                if (!hasAdminUser) {
                    await setAdminExists(env, true);
                    await generateRegCode(env);
                }

                return Response.json({ success: true, role });
            } catch (error) {
                console.error('注册失败:', error);
                return Response.json({ success: false, error: '注册失败，请稍后重试' }, { status: 500 });
            }
        }

        // ============================================================
        // 登录
        // ============================================================
        if (path === '/login' && request.method === 'POST') {
            try {
                const body = await request.json() as { email?: string; password?: string };
                const email = normalizeEmail(body.email);
                const password = String(body.password || '');
                const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';

                // 简单的失败计数限速（15 分钟窗口）
                const throttleKey = `login_fail:${clientIp}`;
                const failCount = parseInt((await env.EMAIL_USER.get(throttleKey)) || '0', 10);
                if (failCount >= 10) {
                    return Response.json({ success: false, error: '尝试过于频繁，请 15 分钟后再试' }, { status: 429 });
                }

                const user = await getUser(env, email);
                const check = user
                    ? await verifyPassword(password, user.password_hash)
                    : { ok: false, needsRehash: false };

                if (!user || !check.ok) {
                    try { await env.EMAIL_USER.put(throttleKey, String(failCount + 1), { expirationTtl: 900 }); } catch { /* ignore */ }
                    // 统一文案，避免枚举出哪些邮箱已注册
                    return Response.json({ success: false, error: '邮箱或密码错误' }, { status: 400 });
                }

                if (check.needsRehash) {
                    // 旧记录是无盐 sha256，登录成功后顺手升级成 PBKDF2
                    try { await updateUserPassword(env, email, await hashPassword(password)); } catch (e) { console.error('口令升级失败:', e); }
                }

                try { await env.EMAIL_USER.delete(throttleKey); } catch { /* ignore */ }

                const sessionId = await createSession(env, email, user.role);
                // 会话 Cookie 由服务端下发：HttpOnly，前端 JS 读不到
                return Response.json(
                    { success: true, role: user.role },
                    { headers: { 'Set-Cookie': sessionCookie(sessionId, 60 * 60 * 24 * 7) } }
                );
            } catch (error) {
                console.error('登录失败:', error);
                return Response.json({ success: false, error: '登录失败，请稍后重试' }, { status: 500 });
            }
        }

        // ============================================================
        // 退出（销毁服务端会话 + 清除 Cookie）
        // ============================================================
        if (path === '/logout' && request.method === 'POST') {
            const sessionId = readSessionId(request);
            if (sessionId) await destroySession(env, sessionId);
            return Response.json({ success: true }, {
                headers: { 'Set-Cookie': sessionCookie('', 0) }
            });
        }

        // ============================================================
        // 修改自己的密码（所有登录用户可用，管理员也一样）
        // ============================================================
        if (path === '/user/password' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ success: false, error: '未登录' }, { status: 401 });

            try {
                const body = await request.json() as { currentPassword?: string; newPassword?: string };
                const currentPassword = String(body.currentPassword || '');
                const newPassword = String(body.newPassword || '');

                if (newPassword.length < 6) {
                    return Response.json({ success: false, error: '新密码至少 6 位' }, { status: 400 });
                }
                if (newPassword === currentPassword) {
                    return Response.json({ success: false, error: '新密码不能与当前密码相同' }, { status: 400 });
                }

                const user = await getUser(env, session.email);
                if (!user) return Response.json({ success: false, error: '用户不存在' }, { status: 404 });

                const check = await verifyPassword(currentPassword, user.password_hash);
                if (!check.ok) {
                    return Response.json({ success: false, error: '当前密码不正确' }, { status: 400 });
                }

                await updateUserPassword(env, session.email, await hashPassword(newPassword));

                // 改密后把该用户的其他会话一并注销，只保留当前这个
                const currentSessionId = readSessionId(request);
                try {
                    const listed = await env.EMAIL_USER.list({ prefix: 'session:' });
                    for (const entry of listed.keys) {
                        const sid = entry.name.slice('session:'.length);
                        if (sid === currentSessionId) continue;
                        const other = await getSession(env, sid);
                        if (other && other.email === session.email) await destroySession(env, sid);
                    }
                } catch (e) {
                    console.error('清理其他会话失败:', e);
                }

                return Response.json({ success: true });
            } catch (error) {
                console.error('修改密码失败:', error);
                return Response.json({ success: false, error: '修改失败，请稍后重试' }, { status: 500 });
            }
        }

        // ============================================================
        // 管理员设置（GET）
        // ============================================================
        if (path === '/admin/settings' && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ success: false, error: '未登录' }, { status: 401 });
            if (session.role !== 'admin') return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });

            const settings = await getAdminSettings(env);
            const regCodePlain = await env.EMAIL_USER.get('admin:regcode_plain');
            const regCode = regCodePlain || '暂无注册码';
            return Response.json({ success: true, ...settings, regCode });
        }

        // ============================================================
        // 管理员设置（POST）
        // ============================================================
        if (path === '/admin/settings' && request.method === 'POST') {
            try {
                const session = await getSessionFromCookie();
                if (!session) return Response.json({ success: false, error: '未登录' }, { status: 401 });
                if (session.role !== 'admin') return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });

                const body = await request.json() as { title?: string; senderPrefix?: string; autoReply?: boolean };
                // 口令不再从这里改：改密码统一走 /user/password（校验当前密码后写 user:<email> 记录）。
                // 旧代码把散列写进 admin:password_hash，而登录从不读这个 key，等于改了个寂寞。
                await saveAdminSettings(env, body.title, body.senderPrefix, body.autoReply);
                return Response.json({ success: true });
            } catch (error) {
                console.error('保存设置失败:', error);
                return Response.json({ success: false, error: '保存失败，请稍后重试' }, { status: 500 });
            }
        }

        // ============================================================
        // 生成注册码
        // ============================================================
        if (path === '/admin/regcode' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ success: false, error: '未登录' }, { status: 401 });
            if (session.role !== 'admin') return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });

            const code = await generateRegCode(env);
            return Response.json({ success: true, regCode: code });
        }

        // ============================================================
        // 检查 Resend
        // ============================================================
        if (path === '/check-resend') {
            return Response.json({ configured: !!env.RESEND_API_KEY });
        }

        // ============================================================
        // 下载附件（通过邮件 ID）
        // ============================================================
        if (path.startsWith('/download/') && request.method === 'GET') {
            const id = safeDecode(path.replace('/download/', ''));
            if (id === null) {
                return Response.json({ error: '非法的邮件 ID' }, { status: 400 });
            }
            if (!id) {
                return Response.json({ error: '缺少邮件 ID' }, { status: 400 });
            }

            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            const mailData = await env.EMAIL.get(id);
            if (!mailData) {
                return Response.json({ error: '邮件不存在' }, { status: 404 });
            }
            const mail = safeJsonParse<StoredEmail | null>(mailData, null);
            if (!mail) return Response.json({ error: '邮件数据损坏' }, { status: 500 });

            if (!canAccessMail(session, mail)) {
                return Response.json({ error: '无权下载' }, { status: 403 });
            }

            if (!mail.attachments || mail.attachments.length === 0) {
                return Response.json({ error: '该邮件没有附件' }, { status: 404 });
            }

            const firstAttachment = mail.attachments[0];
            const attachment = await getAttachment(env, firstAttachment.key);
            if (!attachment) {
                return Response.json({ error: '附件文件不存在' }, { status: 404 });
            }

            return attachmentResponse(attachment);
        }

        // ============================================================
        // 下载附件（通过 key）
        // ============================================================
        if (path.startsWith('/attachments/') && request.method === 'GET') {
            const key = safeDecode(path.replace('/attachments/', ''));
            if (key === null) {
                return Response.json({ error: '非法的附件 ID' }, { status: 400 });
            }
            if (!key) {
                return Response.json({ error: '缺少附件 ID' }, { status: 400 });
            }

            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            // 先确认归属再读文件，避免用「文件是否存在」当探测口
            const messageId = key.split('/')[0];
            const mailData = await env.EMAIL.get(messageId);
            if (!mailData) {
                return Response.json({ error: '邮件不存在' }, { status: 404 });
            }
            const mail = safeJsonParse<StoredEmail | null>(mailData, null);
            if (!mail) return Response.json({ error: '邮件数据损坏' }, { status: 500 });
            if (!canAccessMail(session, mail)) {
                return Response.json({ error: '无权下载' }, { status: 403 });
            }

            const attachment = await getAttachment(env, key);
            if (!attachment) {
                return Response.json({ error: '附件不存在' }, { status: 404 });
            }

            // ?inline=1 用于邮件正文里的内嵌图片
            return attachmentResponse(attachment, url.searchParams.get('inline') === '1');
        }

        // ============================================================
        // 获取邮件列表（只返回摘要，正文走 /mail/:id）
        // ============================================================
        if (path === '/mails' && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            let ids: string[] = [];
            if (session.role === 'admin') {
                ids = safeJsonParse<string[]>(await env.EMAIL.get('_mail_ids'), []);
            } else {
                const userListKey = `user:${normalizeEmail(session.email)}:list`;
                ids = safeJsonParse<string[]>(await env.EMAIL_USER.get(userListKey), []);
            }
            if (!Array.isArray(ids)) ids = [];

            const total = ids.length;
            const recentIds = ids.slice(-MAIL_LIST_LIMIT).reverse();
            const mails: ReturnType<typeof mailSummary>[] = [];
            for (const id of recentIds) {
                if (!id) continue;
                const data = await env.EMAIL.get(id);
                if (!data) continue;
                const mail = safeJsonParse<StoredEmail | null>(data, null);
                if (mail) mails.push(mailSummary(mail));
            }
            return Response.json({ mails, total });
        }

        // ============================================================
        // 获取单封邮件
        // ============================================================
        if (path.startsWith('/mail/') && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            const id = safeDecode(path.split('/')[2] || '');
            if (id === null) return Response.json({ error: '非法的邮件 ID' }, { status: 400 });
            if (!id) return Response.json({ error: '缺少邮件 ID' }, { status: 400 });

            const data = await env.EMAIL.get(id);
            if (!data) return Response.json({ error: '邮件不存在' }, { status: 404 });

            const mail = safeJsonParse<StoredEmail | null>(data, null);
            if (!mail) return Response.json({ error: '邮件数据损坏' }, { status: 500 });
            if (!canAccessMail(session, mail)) {
                return Response.json({ error: '无权查看' }, { status: 403 });
            }
            return Response.json(mail);
        }

        // ============================================================
        // 删除邮件（同时删除附件，并清理所有收件人的列表）
        // ============================================================
        if (path.startsWith('/mail/') && request.method === 'DELETE') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            const id = safeDecode(path.split('/')[2] || '');
            if (id === null) return Response.json({ error: '非法的邮件 ID' }, { status: 400 });
            if (!id) return Response.json({ error: '缺少邮件 ID' }, { status: 400 });

            const data = await env.EMAIL.get(id);
            if (!data) return Response.json({ error: '邮件不存在' }, { status: 404 });

            const mail = safeJsonParse<StoredEmail | null>(data, null);
            if (!mail) return Response.json({ error: '邮件数据损坏' }, { status: 500 });
            // 普通用户只允许删除发给自己的邮件
            if (session.role !== 'admin' && normalizeEmail(mail.to) !== normalizeEmail(session.email)) {
                return Response.json({ error: '无权删除' }, { status: 403 });
            }

            await env.EMAIL.delete(id);

            if (mail.attachments && mail.attachments.length > 0) {
                await deleteAttachments(env, id);
            }

            const allIds = safeJsonParse<string[]>(await env.EMAIL.get('_mail_ids'), []);
            const nextIds = Array.isArray(allIds) ? allIds.filter(i => i !== id) : [];
            await env.EMAIL.put('_mail_ids', JSON.stringify(nextIds));

            // 以前只在非管理员删除时清理「当前用户」一个列表，
            // 管理员删除或多人收件时其他用户的列表会残留死 ID。
            const owners = new Set<string>();
            const primary = normalizeEmail(mail.to);
            if (primary) owners.add(primary);
            for (const r of mail.recipients || []) {
                const e = normalizeEmail(r);
                if (e) owners.add(e);
            }
            for (const owner of owners) {
                const userListKey = `user:${owner}:list`;
                const raw = await env.EMAIL_USER.get(userListKey);
                const list = safeJsonParse<string[]>(raw, []);
                if (!Array.isArray(list)) continue;
                const next = list.filter(i => i !== id);
                if (next.length !== list.length) {
                    try {
                        await env.EMAIL_USER.put(userListKey, JSON.stringify(next));
                    } catch (e) {
                        console.error(`清理用户列表失败: ${userListKey}`, e);
                    }
                }
            }

            return Response.json({ success: true });
        }

        // ============================================================
        // 发送邮件（含附件）
        // ============================================================
        if (path === '/send' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            if (!env.RESEND_API_KEY) {
                return Response.json({ success: false, error: 'Resend API Key 未配置' }, { status: 400 });
            }

            try {
                const body = await request.json() as {
                    to: string | string[];
                    subject: string;
                    html: string;
                    text?: string;
                    attachments?: { filename: string; content: string }[];
                };

                const toList = (Array.isArray(body.to) ? body.to : [body.to])
                    .map(a => extractAddress(a))
                    .filter(Boolean);
                if (toList.length === 0) {
                    return Response.json({ success: false, error: '收件人地址不合法' }, { status: 400 });
                }
                if (toList.length > 50) {
                    return Response.json({ success: false, error: '单次收件人不能超过 50 个' }, { status: 400 });
                }
                const attachments = Array.isArray(body.attachments) ? body.attachments : [];
                const attachmentBytes = attachments.reduce(
                    (sum, a) => sum + Math.ceil(String(a?.content || '').length * 3 / 4),
                    0
                );
                if (attachmentBytes > 10 * 1024 * 1024) {
                    return Response.json({ success: false, error: '附件总大小不能超过 10MB' }, { status: 400 });
                }

                // 每个用户每天发信上限，避免账号被拿来做发信跳板
                const quotaKey = `send_quota:${normalizeEmail(session.email)}:${new Date().toISOString().slice(0, 10)}`;
                const used = parseInt((await env.EMAIL_USER.get(quotaKey)) || '0', 10);
                const dailyLimit = session.role === 'admin' ? 500 : 100;
                if (used >= dailyLimit) {
                    return Response.json({ success: false, error: '今日发信额度已用完' }, { status: 429 });
                }

                const sender = `${sanitizeSenderPrefix(await env.EMAIL_USER.get('admin:sender_prefix'))}@${env.DOMAIN}`;
                const result = await sendEmail(
                    env.RESEND_API_KEY,
                    sender,
                    toList,
                    String(body.subject || ''),
                    String(body.html || ''),
                    body.text,
                    attachments
                );
                try {
                    await env.EMAIL_USER.put(quotaKey, String(used + 1), { expirationTtl: 60 * 60 * 48 });
                } catch { /* ignore */ }
                return Response.json({ success: true, id: result.id });
            } catch (error) {
                console.error('发信失败:', error);
                return Response.json({ success: false, error: '发送失败，请稍后重试' }, { status: 500 });
            }
        }

        if (path === '/manifest.json') {
            const manifest = {
                name: '红怪邮件',
                short_name: '邮件',
                description: '轻量级邮件收发系统',
                start_url: '/',
                display: 'standalone',
                background_color: '#667eea',
                theme_color: '#667eea',
                icons: [
                    {
                        src: '/icon.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: '/icon.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ],
                protocol_handlers: [
                    {
                        protocol: 'mailto',
                        url: '/new-email?to=%s'
                    }
                ]
            };
            return new Response(JSON.stringify(manifest), {
                headers: {
                    'Content-Type': 'application/manifest+json; charset=utf-8',
                    'Cache-Control': 'public, max-age=86400'
                },
            });
        }


        // ============================================================
        // mailto 链接跳转
        // ============================================================
        if (path === '/new-email') {
            return new Response(HTML_TEMPLATE, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Cache-Control': 'no-cache'
                },
            });
        }

        // ============================================================
        // 获取 VAPID 公钥
        // ============================================================
        if (path === '/push/vapid-public-key') {
            return Response.json({ publicKey: env.VAPID_PUBLIC_KEY });
        }

        // ============================================================
        // 保存推送订阅
        // ============================================================
        if (path === '/push/subscribe' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            try {
                const subscription = await request.json() as { endpoint?: string };
                // 只接受指向已知推送服务的 endpoint：以前原样保存，
                // 收信时会对订阅里的任意 URL 发请求（盲 SSRF）。
                const endpoint = String(subscription?.endpoint || '');
                if (!isAllowedPushEndpoint(endpoint)) {
                    return Response.json({ success: false, error: '推送订阅地址不合法' }, { status: 400 });
                }
                await env.EMAIL_USER.put(
                    `push:${normalizeEmail(session.email)}`,
                    JSON.stringify(subscription)
                );
                await env.EMAIL_USER.delete(`push_failed:${normalizeEmail(session.email)}`);
                return Response.json({ success: true });
            } catch (error) {
                return Response.json({ success: false, error: '订阅数据不合法' }, { status: 400 });
            }
        }

        // ============================================================
        // 取消推送订阅
        // ============================================================
        if (path === '/push/unsubscribe' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            await env.EMAIL_USER.delete(`push:${normalizeEmail(session.email)}`);
            return Response.json({ success: true });
        }


        // ============================================================
        // PWA 图标
        // ============================================================
        if (path === '/icon.png') {
            const base64 = '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';
            return getIconPng(base64);
        }

        // ============================================================
        // Service Worker
        // ============================================================
        if (path === '/sw.js') {
            const sw = `self.addEventListener('push', function(event) {
    let data = { title: '📧 新邮件', body: '你收到了一封新邮件', url: '/' };
    if (event.data) {
        try { data = event.data.json(); } catch (e) { data.body = event.data.text(); }
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon.png',
            data: { url: data.url || '/' },
            tag: 'mail-notification',
            renotify: true
        })
    );
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(function(clientList) {
                for (const client of clientList) {
                    if (client.url.includes(self.location.origin) && 'focus' in client) {
                        client.navigate(url);
                        return client.focus();
                    }
                }
                if (clients.openWindow) return clients.openWindow(url);
            })
    );
});`;
            return new Response(sw, {
                headers: {
                    'Content-Type': 'application/javascript; charset=utf-8',
                    'Cache-Control': 'no-cache'
                }
            });
        }

        // ============================================================
        // 首页
        // ============================================================
        if (path === '/' || path === '') {
            return new Response(HTML_TEMPLATE, {
                headers: {
                    'Content-Type': 'text/html; charset=utf-8',
                    // 页面本身不缓存：避免前端与接口契约不一致时出现「旧页面 + 新后端」
                    'Cache-Control': 'no-cache'
                },
            });
        }

        if (path === '/style.css') {
            const css = `* { margin: 0; padding: 0; box-sizing: border-box; }
body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f0f2f5;
    color: #1a1a2e;
    padding: 20px;
}
.app { max-width: 1200px; margin: 0 auto; }
header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 24px 32px;
    border-radius: 16px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 8px 32px rgba(102, 126, 234, 0.3);
}
header h1 { font-size: 24px; font-weight: 600; }
header .badge {
    background: rgba(255,255,255,0.2);
    padding: 6px 16px;
    border-radius: 20px;
    font-size: 14px;
    cursor: default;
}
header .badge.clickable { cursor: pointer; }
header .badge.clickable:hover { background: rgba(255,255,255,0.3); }
.container {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 24px;
}
@media (max-width: 768px) { .container { grid-template-columns: 1fr; } }
.sidebar {
    background: white;
    border-radius: 16px;
    padding: 20px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    height: fit-content;
    position: sticky;
    top: 20px;
}
.sidebar h2 { font-size: 16px; color: #666; margin-bottom: 12px; letter-spacing: 0.5px; }
.compose-btn {
    width: 100%;
    padding: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    margin-bottom: 20px;
}
.compose-btn:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4); }
.compose-btn:active { transform: translateY(0); }
.stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-bottom: 20px;
}
.stat-item {
    background: #f8f9fc;
    padding: 12px;
    border-radius: 10px;
    text-align: center;
}
.stat-item .num { font-size: 22px; font-weight: 700; color: #667eea; }
.stat-item .label { font-size: 12px; color: #999; margin-top: 2px; }
.mail-list {
    background: white;
    border-radius: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    overflow: hidden;
    min-height: 400px;
}
.mail-list-header {
    padding: 16px 20px;
    border-bottom: 1px solid #eee;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.mail-list-header h2 { font-size: 18px; font-weight: 600; }
.refresh-btn {
    background: none;
    border: none;
    color: #667eea;
    cursor: pointer;
    font-size: 20px;
    padding: 4px 8px;
    border-radius: 8px;
    transition: background 0.15s;
}
.refresh-btn:hover { background: #f0f2ff; }
.mail-item {
    padding: 16px 20px;
    border-bottom: 1px solid #f5f5f5;
    cursor: pointer;
    transition: background 0.12s;
    display: flex;
    align-items: center;
    gap: 12px;
}
.mail-item:hover { background: #f8f9fc; }
.mail-item .avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(135deg, #a8c0ff 0%, #3f2b96 100%);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 14px;
    flex-shrink: 0;
}
.mail-item .info { flex: 1; min-width: 0; }
.mail-item .info .from { font-weight: 600; font-size: 14px; }
.mail-item .info .subject { font-size: 13px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mail-item .info .time { font-size: 12px; color: #999; }
.mail-item .status-badge {
    font-size: 11px;
    padding: 2px 10px;
    border-radius: 12px;
    background: #e8f5e9;
    color: #2e7d32;
    flex-shrink: 0;
}
.mail-item .status-badge.replied { background: #e3f2fd; color: #1565c0; }
.empty-state { padding: 60px 20px; text-align: center; color: #999; }
.empty-state .icon { font-size: 48px; margin-bottom: 12px; }

/* ===== 模态框 ===== */
.modal-overlay {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    backdrop-filter: blur(4px);
    z-index: 1000;
    align-items: center;
    justify-content: center;
}
.modal-overlay.active { display: flex; }
.modal {
    background: white;
    border-radius: 0;
    max-width: 100%;
    width: 100%;
    height: 100%;
    max-height: 100%;
    overflow-y: auto;
    padding: 32px;
    box-shadow: none;
}
@keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}
.modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
}
.modal-header h3 { font-size: 20px; }
.modal-close {
    background: none;
    border: none;
    font-size: 28px;
    cursor: pointer;
    color: #999;
    padding: 0 8px;
}
.modal-close:hover { color: #333; }
.modal label {
    display: block;
    font-size: 14px;
    font-weight: 600;
    margin-top: 16px;
    margin-bottom: 4px;
    color: #555;
}
.modal input, .modal textarea {
    width: 100%;
    padding: 10px 14px;
    border: 2px solid #e8ecf4;
    border-radius: 10px;
    font-size: 14px;
    font-family: inherit;
    transition: border-color 0.15s;
}
.modal input:focus, .modal textarea:focus { outline: none; border-color: #667eea; }
.modal textarea { min-height: 120px; resize: vertical; }
.modal .send-btn {
    margin-top: 20px;
    width: 100%;
    padding: 14px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 12px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
}
.modal .send-btn:hover { opacity: 0.9; }
.modal .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.toast {
    position: fixed;
    bottom: 30px;
    left: 50%;
    transform: translateX(-50%);
    background: #1a1a2e;
    color: white;
    padding: 12px 28px;
    border-radius: 12px;
    font-size: 14px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    display: none;
    z-index: 2000;
    animation: slideUp 0.2s ease;
}
.toast.show { display: block; }
.toast.error { background: #c62828; }

.loading-spinner {
    display: inline-block;
    width: 18px;
    height: 18px;
    border: 2px solid #e0e0e0;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.editor-split {
    display: flex;
    gap: 12px;
    min-height: 300px;
    margin-top: 4px;
}
.editor-split .left { flex: 1; display: flex; flex-direction: column; }
.editor-split .left textarea {
    flex: 1;
    min-height: 280px;
    padding: 10px 14px;
    border: 2px solid #e8ecf4;
    border-radius: 10px;
    font-size: 14px;
    font-family: 'Courier New', monospace;
    resize: vertical;
    transition: border-color 0.15s;
}
.editor-split .left textarea:focus { outline: none; border-color: #667eea; }
.editor-split .right {
    flex: 1;
    min-height: 280px;
    padding: 12px;
    border: 2px solid #e8ecf4;
    border-radius: 10px;
    background: #fafbfc;
    overflow-y: auto;
    line-height: 1.7;
    word-wrap: break-word;
    outline: none;
}
.editor-split .right:focus { border-color: #667eea; }
/* 预览区的提示由 CSS 生成，是纯样式而不是内容：
   进到框里直接打字就行，不用先把提示文字删掉 */
.editor-split .right:empty::before,
.editor-split .right:has(> br:only-child)::before {
    content: attr(data-placeholder);
    color: #b6bcc8;
    font-size: 14px;
    pointer-events: none;
}
.editor-label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 16px;
    margin-bottom: 4px;
}
.editor-label label { margin-top: 0; margin-bottom: 0; }
.editor-label .hint { font-size: 12px; color: #999; }
.resend-hint {
    display: none;
    color: #e74c3c;
    font-size: 13px;
    margin-top: 8px;
    padding: 10px 14px;
    background: #fef0ef;
    border-radius: 8px;
    border: 1px solid #f5c6cb;
    line-height: 1.6;
}
.resend-hint code { background: #f0f0f0; padding: 2px 8px; border-radius: 4px; font-size: 12px; }

/* ===== 登录/注册页面 ===== */
.auth-page {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: #f0f2f5;
}
.auth-box {
    background: white;
    padding: 40px;
    border-radius: 16px;
    max-width: 400px;
    width: 100%;
    box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.auth-box h2 { text-align: center; margin-bottom: 24px; }
.auth-box input {
    width: 100%;
    padding: 10px 14px;
    border: 2px solid #e8ecf4;
    border-radius: 10px;
    font-size: 14px;
    margin-bottom: 12px;
    font-family: inherit;
    transition: border-color 0.15s;
}
.auth-box input:focus { outline: none; border-color: #667eea; }
.auth-box .auth-btn {
    width: 100%;
    padding: 12px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
}
.auth-box .auth-btn:hover { background: #5a6fd6; }
.auth-box .auth-link {
    text-align: center;
    margin-top: 12px;
    font-size: 14px;
    color: #666;
}
.auth-box .auth-link a { color: #667eea; cursor: pointer; text-decoration: none; }
.auth-box .auth-link a:hover { text-decoration: underline; }
.auth-box .auth-error { color: #e74c3c; font-size: 13px; margin-bottom: 8px; display: none; }
.auth-box .auth-hint { color: #999; font-size: 13px; text-align: center; margin-bottom: 12px; }

/* ===== 管理员面板 ===== */
.admin-panel {
    display: none;
    margin-top: 20px;
    padding: 16px;
    background: #f8f9fc;
    border-radius: 12px;
    border: 1px solid #e8ecf4;
}
.admin-panel h3 { font-size: 15px; margin-bottom: 12px; color: #333; }
.admin-panel .field { margin-bottom: 10px; }
.admin-panel .field label { font-size: 13px; font-weight: 600; display: block; margin-bottom: 2px; color: #555; }
.admin-panel .field input {
    width: 100%;
    padding: 8px 12px;
    border: 2px solid #e8ecf4;
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    transition: border-color 0.15s;
}
.admin-panel .field input:focus { outline: none; border-color: #667eea; }
.admin-panel .field input[readonly] { background: #f5f5f5; color: #999; cursor: not-allowed; }
.admin-panel .field .email-row { display: flex; align-items: center; gap: 4px; }
.admin-panel .field .email-row input { flex: 0 0 auto; width: 120px; }
.admin-panel .field .email-row span { color: #999; font-size: 14px; }
.admin-panel .field .email-row .domain-part { flex: 1; background: #f5f5f5; color: #999; padding: 8px 12px; border: 2px solid #e8ecf4; border-radius: 6px; font-size: 14px; cursor: not-allowed; }
.admin-panel .field .code-row { display: flex; gap: 8px; }
.admin-panel .field .code-row input { flex: 1; }
.admin-panel .field .code-row button {
    padding: 8px 16px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
}
.admin-panel .field .code-row button:hover { background: #5a6fd6; }
.admin-panel .field .code-row .copy-btn { background: #27ae60; }
.admin-panel .field .code-row .copy-btn:hover { background: #219a52; }
.admin-panel .save-btn {
    width: 100%;
    padding: 10px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 6px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
}
.admin-panel .save-btn:hover { background: #5a6fd6; }
.admin-panel .field-hint { font-size: 12px; color: #999; margin-top: 2px; }

/* ===== 移动端适配 ===== */
@media (max-width: 768px) {
    body { padding: 10px; }
    .app { max-width: 100%; }
    header {
        padding: 16px 20px;
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
    }
    header h1 { font-size: 18px; }
    header .badge { font-size: 12px; padding: 4px 12px; }
    .container { grid-template-columns: 1fr; gap: 16px; }
    .sidebar { position: static; padding: 16px; }
    .stats { grid-template-columns: 1fr 1fr; gap: 6px; }
    .stat-item { padding: 10px; }
    .stat-item .num { font-size: 18px; }
    .mail-list { min-height: 300px; }
    .mail-list-header { padding: 12px 16px; flex-wrap: wrap; gap: 8px; }
    .mail-list-header h2 { font-size: 16px; }
    .mail-item { padding: 12px 16px; gap: 10px; }
    .mail-item .avatar { width: 32px; height: 32px; font-size: 12px; }
    .mail-item .info .from { font-size: 13px; }
    .mail-item .info .subject { font-size: 12px; }
    .mail-item .info .time { font-size: 11px; }
    .mail-item .status-badge { font-size: 10px; padding: 2px 8px; }
    .modal { padding: 20px; max-width: 100%; width: 100%; max-height: 100vh; border-radius: 0; margin: 0; }
    .modal-header h3 { font-size: 17px; }
    .modal label { font-size: 13px; margin-top: 12px; }
    .modal input, .modal textarea { font-size: 14px; padding: 10px 12px; }
    .modal .send-btn { font-size: 15px; padding: 12px; }
    .editor-split { flex-direction: column; gap: 8px; min-height: auto; }
    .editor-split .left textarea { min-height: 200px; font-size: 14px; }
    .editor-split .right { min-height: 200px; font-size: 14px; }
    .editor-label { flex-direction: column; align-items: flex-start; gap: 4px; }
    .editor-label .hint { font-size: 11px; }
    .auth-box { padding: 24px 20px; margin: 10px; max-width: 100%; }
    .auth-box h2 { font-size: 20px; margin-bottom: 16px; }
    .auth-box input { font-size: 14px; padding: 12px 14px; }
    .auth-box .auth-btn { font-size: 15px; padding: 12px; }
    .auth-box .auth-link { font-size: 13px; }
    .admin-panel { padding: 12px; }
    .admin-panel h3 { font-size: 14px; }
    .admin-panel .field label { font-size: 12px; }
    .admin-panel .field input { font-size: 13px; padding: 6px 10px; }
    .admin-panel .field .email-row { flex-wrap: wrap; }
    .admin-panel .field .email-row input { flex: 1; min-width: 80px; width: auto; }
    .admin-panel .field .email-row .domain-part { font-size: 13px; padding: 6px 10px; }
    .admin-panel .field .code-row { flex-wrap: wrap; }
    .admin-panel .field .code-row input { flex: 1; min-width: 100px; }
    .admin-panel .field .code-row button { font-size: 12px; padding: 6px 12px; }
    .admin-panel .save-btn { font-size: 14px; padding: 10px; }
    #viewModal .modal { max-width: 100%; padding: 16px; }
    #viewModal .modal-header h3 { font-size: 16px; }
    #viewBody {max-height: 60vh;overflow-y: auto;word-wrap: break-word;}
    #viewModal .send-btn { font-size: 13px; padding: 10px; }
    .toast { font-size: 13px; padding: 10px 20px; max-width: 90%; bottom: 16px; }
}
@media (max-width: 400px) {
    body { padding: 6px; }
    header { padding: 12px 14px; }
    header h1 { font-size: 16px; }
    .sidebar { padding: 12px; }
    .compose-btn { padding: 12px; font-size: 14px; }
    .mail-item { padding: 10px 12px; }
    .modal { padding: 16px; margin: 0; }
    .auth-box { padding: 16px; }
    .editor-split .left textarea { min-height: 150px; }
    .editor-split .right { min-height: 150px; }
    .admin-panel .field .email-row { flex-direction: column; align-items: stretch; }
    .admin-panel .field .email-row input { width: 100%; flex: none; }
    .admin-panel .field .email-row .domain-part { width: 100%; }
    .admin-panel .field .code-row { flex-direction: column; }
    .admin-panel .field .code-row input { width: 100%; }
    .admin-panel .field .code-row button { width: 100%; justify-content: center; }
}`;
            return new Response(css, {
                headers: {
                    'Content-Type': 'text/css; charset=utf-8',
                    // 和 app.js 一样不缓存：样式与页面结构是一起变的
                    'Cache-Control': 'no-cache'
                },
            });
        }

        if (path === '/app.js') {
        const js = `const style = "color: red; font-size: 60px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);";
function warn() {
    console.log("%c请不要在这里复制粘贴任何代码，如果有人想要让你复制粘贴，那么他是骗子", style);
}
warn();
setInterval(warn, 10000);

const $ = id => document.getElementById(id);

// 写邮件预览区的提示文字写在 template.html 的 data-placeholder 上，
// 由 CSS 的 :empty::before 渲染成灰色提示，不是真实内容：
// 既不会被当成正文发出去，也不用先删掉才能开始写。

/** 预览区是否没有任何真实内容（空，或只剩一个 <br>） */
function isComposePlaceholder(html) {
    if (html === null || html === undefined) return true;
    const text = String(html)
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    return text === '';
}

function showToast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove('show'), 3000);
}

function showError(elId, msg) {
    const el = $(elId);
    el.textContent = msg;
    el.style.display = 'block';
}

function hideError(elId) {
    $(elId).style.display = 'none';
}

// ============================================================
// 文本/HTML 互转
// ============================================================
/** 把纯文本安全地转成 HTML（先转义再换行），避免把邮件原文当 HTML 注入页面 */
function textToHtml(text) {
    return escapeHtml(String(text == null ? '' : text))
        .replace(/\\r\\n?/g, '\\n')
        .split('\\n')
        .join('<br>');
}

/** 回复主题：已带 Re: 前缀不重复加 */
function replySubject(subject) {
    const s = String(subject == null ? '' : subject).trim();
    if (!s || s === '(无主题)') return 'Re: (无主题)';
    return /^re\\s*:/i.test(s) ? s : 'Re: ' + s;
}

// ============================================================
// 登录/注册切换
// ============================================================
function showLogin() {
    $('loginPage').style.display = 'flex';
    $('registerPage').style.display = 'none';
    hideError('loginError');
    hideError('regError');
}

function showRegister() {
    $('loginPage').style.display = 'none';
    $('registerPage').style.display = 'flex';
    hideError('loginError');
    hideError('regError');
    checkHasAdmin();
}

// ============================================================
// 检查是否有管理员
// ============================================================
let hasAdminCached = null;

async function checkHasAdmin() {
    try {
        const resp = await fetch('/admin/check');
        const data = await resp.json();
        hasAdminCached = data.hasAdmin;
        const hint = $('regHint');
        if (data.hasAdmin) {
            hint.textContent = '⚠️ 已有管理员，注册码必填';
            hint.style.color = '#e67e22';
        } else {
            hint.textContent = '✅ 第一个用户注册，注册码可留空（自动成为管理员）';
            hint.style.color = '#27ae60';
        }
        hint.style.display = 'block';
        return data.hasAdmin;
    } catch {
        hasAdminCached = true;
        return true;
    }
}

// ============================================================
// 登录
// ============================================================
async function login() {
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!email || !password) {
        showError('loginError', '请填写完整信息');
        return;
    }
    hideError('loginError');

    try {
        const resp = await fetch('/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // 直接送明文口令（HTTPS），由服务端做 PBKDF2 校验。
            // 以前在前端算无盐 sha256 当口令用，等于把可重放的凭证放在浏览器里。
            body: JSON.stringify({ email, password })
        });
        const data = await resp.json();
        if (!data.success) {
            showError('loginError', data.error || '登录失败');
            return;
        }
        // 会话 Cookie 由服务端 Set-Cookie 下发（HttpOnly），前端不再自己写
        $('loginPassword').value = '';
        loadMainApp();
    } catch (e) {
        showError('loginError', '网络错误，请重试');
    }
}

// ============================================================
// 注册
// ============================================================
async function register() {
    const email = $('regEmail').value.trim();
    const password = $('regPassword').value;
    const regCode = $('regCode').value.trim().toUpperCase();

    if (!email || !password) {
        showError('regError', '请填写邮箱和密码');
        return;
    }
    if (password.length < 6) {
        showError('regError', '密码至少 6 位');
        return;
    }
    hideError('regError');

    const hasAdminUser = await checkHasAdmin();
    if (hasAdminUser && !regCode) {
        showError('regError', '请输入注册码');
        return;
    }

    try {
        const resp = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, regCode })
        });
        const data = await resp.json();
        if (!data.success) {
            showError('regError', data.error || '注册失败');
            return;
        }
        showToast('✅ 注册成功！请登录');
        showLogin();
        $('loginEmail').value = email;
        $('regPassword').value = '';
    } catch (e) {
        showError('regError', '网络错误，请重试');
    }
}

// ============================================================
// 退出
// ============================================================
async function logout() {
    // 先停掉轮询，否则退出后定时器还在打 /mails，登录页会每 30 秒弹一次错误提示
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    try {
        // 必须让服务端销毁会话：以前只删浏览器 cookie，服务端 session 还能用 7 天
        await fetch('/logout', { method: 'POST' });
    } catch (e) { /* 网络失败也继续走本地清理 */ }
    sessionStorage.removeItem('pendingMailto');
    mails = [];
    $('mainApp').style.display = 'none';
    $('loginPage').style.display = 'flex';
    $('loginPassword').value = '';
}

// ============================================================
// 加载主应用
// ============================================================
async function loadMainApp() {
    $('loginPage').style.display = 'none';
    $('registerPage').style.display = 'none';
    $('mainApp').style.display = 'block';

    try {
        const userResp = await fetch('/user/info');
        const userData = await userResp.json();

        if (!userData.success) {
            $('mainApp').style.display = 'none';
            $('loginPage').style.display = 'flex';
            return;
        }

        if (userData.account) $('loginHint').textContent = '管理员账号：' + userData.account;
        if (userData.domain) $('adminSenderDomain').textContent = userData.domain;

        if (userData.title) {
            document.title = userData.title;
            $('headerTitle').textContent = userData.title;
        }

        resendConfigured = userData.resendConfigured || false;
        updateSendButtonVisibility();

        if (userData.user) {
            if (userData.user.role === 'admin') {
                $('userBadge').textContent = '👤 管理员';
                $('adminPanel').style.display = 'block';
            } else {
                $('userBadge').textContent = '👤 ' + userData.user.email;
            }
        }

        if (userData.user && userData.user.role === 'admin') {
            try {
                const adminResp = await fetch('/admin/info');
                if (adminResp.ok) {
                    const adminData = await adminResp.json();
                    if (adminData.settings) {
                        $('adminTitle').value = adminData.settings.title || '';
                        $('adminSenderPrefix').value = adminData.settings.senderPrefix || 'noreply';
                        $('adminRegCode').value = adminData.settings.regCode || '暂无注册码';
                        if (adminData.settings.autoReply !== undefined) {
                            document.querySelector('input[name="autoReply"][value="' + (adminData.settings.autoReply ? 'on' : 'off') + '"]').checked = true;
                        }
                        if (adminData.settings.title) {
                            document.title = adminData.settings.title;
                            $('headerTitle').textContent = adminData.settings.title;
                        }
                    }
                }
            } catch { /* ignore */ }
        }

        await loadMails();
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(loadMails, 30000);
    } catch (e) {
        console.error('加载失败，使用降级方案:', e);
        await loadMails();
        if (refreshInterval) clearInterval(refreshInterval);
        refreshInterval = setInterval(loadMails, 30000);
    }
}

// ============================================================
// 保存管理员设置
// ============================================================
async function saveAdminSettings() {
    const title = $('adminTitle').value.trim();
    const senderPrefix = $('adminSenderPrefix').value.trim();
    const autoReply = document.querySelector('input[name="autoReply"]:checked').value === 'on';

    // 改密码不在这里：走独立的「修改密码」弹窗（/user/password）
    const payload = { title, senderPrefix, autoReply };

    try {
        const resp = await fetch('/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!data.success) { showToast('保存失败: ' + data.error, true); return; }
        showToast('✅ 设置已保存');
        const adminResp = await fetch('/admin/info');
        if (adminResp.ok) {
            const adminData = await adminResp.json();
            if (adminData.settings) {
                $('adminTitle').value = adminData.settings.title || '';
                $('adminSenderPrefix').value = adminData.settings.senderPrefix || 'noreply';
                $('adminRegCode').value = adminData.settings.regCode || '暂无注册码';
                if (adminData.settings.autoReply !== undefined) {
                    document.querySelector('input[name="autoReply"][value="' + (adminData.settings.autoReply ? 'on' : 'off') + '"]').checked = true;
                }
                if (adminData.settings.title) {
                    document.title = adminData.settings.title;
                    $('headerTitle').textContent = adminData.settings.title;
                }
            }
        }
    } catch (e) { showToast('网络错误', true); }
}

// ============================================================
// 修改自己的密码（所有用户可用，不放在管理员面板里）
// ============================================================
function openPasswordModal() {
    $('pwdCurrent').value = '';
    $('pwdNew').value = '';
    $('pwdConfirm').value = '';
    hideError('pwdError');
    $('passwordModal').classList.add('active');
}

function closePasswordModal() {
    $('passwordModal').classList.remove('active');
}

async function changePassword() {
    const currentPassword = $('pwdCurrent').value;
    const newPassword = $('pwdNew').value;
    const confirmPassword = $('pwdConfirm').value;

    if (!currentPassword || !newPassword) {
        showError('pwdError', '请填写当前密码和新密码');
        return;
    }
    if (newPassword.length < 6) {
        showError('pwdError', '新密码至少 6 位');
        return;
    }
    if (newPassword !== confirmPassword) {
        showError('pwdError', '两次输入的新密码不一致');
        return;
    }
    if (newPassword === currentPassword) {
        showError('pwdError', '新密码不能与当前密码相同');
        return;
    }
    hideError('pwdError');

    try {
        const resp = await fetch('/user/password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword })
        });
        const data = await resp.json();
        if (!data.success) {
            showError('pwdError', data.error || '修改失败');
            return;
        }
        closePasswordModal();
        showToast('✅ 密码已修改，其他设备上的登录已失效');
    } catch (e) {
        showError('pwdError', '网络错误，请重试');
    }
}

// ============================================================
// 生成注册码
// ============================================================
async function generateRegCode() {
    try {
        const resp = await fetch('/admin/regcode', { method: 'POST' });
        const data = await resp.json();
        if (!data.success) { showToast('生成失败: ' + data.error, true); return; }
        $('adminRegCode').value = data.regCode;
        showToast('✅ 新注册码已生成');
    } catch (e) { showToast('网络错误', true); }
}

// ============================================================
// 复制注册码
// ============================================================
function copyRegCode() {
    const codeInput = $('adminRegCode');
    const code = codeInput.value;
    if (!code || code === '暂无注册码') {
        showToast('没有可复制的注册码，请先生成', true);
        return;
    }
    navigator.clipboard.writeText(code).then(() => {
        showToast('✅ 注册码已复制');
    }).catch(() => {
        codeInput.select();
        document.execCommand('copy');
        showToast('✅ 注册码已复制');
    });
}

// ============================================================
// Resend 状态
// ============================================================
let resendConfigured = false;
let refreshInterval = null;

function updateSendButtonVisibility() {
    const btn = $('composeSendBtn');
    const hint = $('resendHint');
    const composeBtn = document.querySelector('.compose-btn');
    if (!resendConfigured) {
        btn.style.display = 'none';
        hint.style.display = 'block';
        if (composeBtn) composeBtn.style.display = 'none';
    } else {
        btn.style.display = 'block';
        hint.style.display = 'none';
        if (composeBtn) composeBtn.style.display = 'block';
    }
}

// ============================================================
// 邮件列表
// ============================================================
let mails = [];
let mailTotal = 0;
let currentViewId = null;
const mailListEl = $('mailList');

async function loadMails() {
    try {
        const resp = await fetch('/mails');
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        // 服务端现在只返回摘要（正文按需从 /mail/:id 取）
        mails = data.mails || [];
        mailTotal = typeof data.total === 'number' ? data.total : mails.length;
        renderMails();
        updateStats();
    } catch (e) { showToast('加载邮件失败: ' + e.message, true); }
}

function renderMails() {
    if (mails.length === 0) {
        mailListEl.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>收件箱空空如也</p></div>';
        return;
    }
    var html = '';
    for (var i = 0; i < mails.length; i++) {
        var m = mails[i];
        var from = escapeHtml(m.from || '?');
        var subject = escapeHtml(m.subject || '(无主题)');
        var time = formatTime(m.timestamp);
        var badge = m.status === 'replied' ? 'replied' : '';
        var badgeText = m.status === 'replied' ? '✅ 已回复' : '📩 未回复';
        var clip = m.attachmentCount ? ' 📎' : '';
        // 内联 onclick 已全部改为 data-action（配合 CSP 的 script-src 'self'）
        html += '<div class="mail-item" data-action="viewMail" data-arg="' + escapeHtml(m.id) + '">';
        html += '  <div class="avatar">' + from[0].toUpperCase() + '</div>';
        html += '  <div class="info">';
        html += '    <div class="from">' + from + '</div>';
        html += '    <div class="subject">' + subject + clip + '</div>';
        html += '    <div class="time">' + time + '</div>';
        html += '  </div>';
        html += '  <span class="status-badge ' + badge + '">' + badgeText + '</span>';
        html += '</div>';
    }
    mailListEl.innerHTML = html;
}

function updateStats() {
    // 总数用服务端索引长度，之前显示的是"当前加载的最近 50 封"，有误导
    $('totalCount').textContent = mailTotal;
    $('repliedCount').textContent = mails.filter(m => m.status === 'replied').length;
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function formatTime(ts) {
    if (!ts) return '-';
    try {
        const d = new Date(ts);
        return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return ts; }
}

// ============================================================
// 查看邮件（含附件）
// ============================================================
async function viewMail(id) {
    currentViewId = id;
    try {
        const resp = await fetch('/mail/' + encodeURIComponent(id));
        if (!resp.ok) throw new Error('加载失败');
        const mail = await resp.json();
        $('viewSubject').textContent = mail.subject || '(无主题)';
        $('viewFrom').textContent = mail.from || '未知';
        $('viewTime').textContent = formatTime(mail.timestamp);

        // 用 iframe 隔离渲染邮件内容
        const mailHtml = mail.html || mail.text || '(无内容)';
        const iframeDoc = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>' +
            'body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 14px; line-height: 1.7; color: #1a1a2e; padding: 16px; margin: 0; word-wrap: break-word; }' +
            'img { max-width: 100%; height: auto; }' +
            'a { color: #667eea; }' +
            'table { max-width: 100%; }' +
            '</style></head><body>' + mailHtml + '</body></html>';

        $('viewBody').innerHTML = '<iframe style="width:100%;min-height:400px;border:none;display:block;" sandbox="allow-same-origin"></iframe>';
        const iframe = $('viewBody').querySelector('iframe');
        iframe.srcdoc = iframeDoc;
        iframe.onload = function() {
            try {
                const doc = iframe.contentDocument || iframe.contentWindow.document;
                iframe.style.height = doc.body.scrollHeight + 40 + 'px';
            } catch (e) {
                iframe.style.height = '500px';
            }
        };

        // 显示附件
        const attachments = mail.attachments || [];
        const attachmentContainer = $('viewAttachments');
        const attachmentList = $('viewAttachmentList');
        if (attachments.length > 0) {
            attachmentContainer.style.display = 'block';
            var attHtml = '';
            for (var i = 0; i < attachments.length; i++) {
                var att = attachments[i];
                attHtml += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #eee;">';
                attHtml += '  <span style="font-size:13px;">📎 ' + escapeHtml(att.filename) + '</span>';
                attHtml += '  <span style="font-size:11px;color:#999;">(' + (att.size / 1024).toFixed(1) + ' KB)</span>';
                attHtml += '  <a href="/attachments/' + encodeURIComponent(att.key) + '" target="_blank" style="font-size:12px;color:#667eea;margin-left:auto;">下载</a>';
                attHtml += '</div>';
            }
            attachmentList.innerHTML = attHtml;
        } else {
            attachmentContainer.style.display = 'none';
        }

        // 显示邮件 ID（用 textContent 组装，避免把服务端数据当 HTML 拼）
        const modal = document.querySelector('#viewModal .modal');
        let idDisplay = document.getElementById('mailIdDisplay');
        if (!idDisplay) {
            idDisplay = document.createElement('div');
            idDisplay.id = 'mailIdDisplay';
            idDisplay.style.cssText = 'margin-top:12px;padding:8px 12px;background:#f0f2f5;border-radius:6px;font-size:12px;color:#666;word-break:break-all;border:1px solid #e8ecf4;';
            modal.appendChild(idDisplay);
        }
        idDisplay.textContent = '📋 邮件ID：' + mail.id;

        $('viewModal').classList.add('active');
    } catch (e) {
        showToast('加载邮件详情失败', true);
    }
}

function closeView() {
    $('viewModal').classList.remove('active');
    currentViewId = null;
}

async function replyFromView() {
    if (!currentViewId) return;
    if (!resendConfigured) { showToast('⚠️ 请先配置 Resend API Key', true); return; }

    // 列表里只有摘要，正文要按需取
    let mail = mails.find(m => m.id === currentViewId);
    if (!mail || mail.text === undefined) {
        try {
            const resp = await fetch('/mail/' + encodeURIComponent(currentViewId));
            if (resp.ok) mail = await resp.json();
        } catch (e) { /* 下面统一处理 */ }
    }
    if (!mail || mail.from === undefined) { showToast('加载原邮件失败', true); return; }

    closeView();
    $('composeTo').value = mail.from || '';
    $('composeSubject').value = replySubject(mail.subject);
    // 邮件正文一律先转义再插入：以前直接拼 innerHTML，
    // 发件人只要在纯文本正文里写 <img onerror=...> 就能在点「回复」时执行脚本。
    const replyContent = '<br><br>--- 原始邮件 ---<br>' + textToHtml(mail.text || '');
    $('composeHtml').value = replyContent;
    $('composePreview').innerHTML = replyContent;
    $('composeModal').classList.add('active');
}

async function deleteFromView() {
    if (!currentViewId) return;
    if (!confirm('确定要删除这封邮件吗？')) return;
    try {
        const resp = await fetch('/mail/' + encodeURIComponent(currentViewId), { method: 'DELETE' });
        if (!resp.ok) throw new Error('删除失败');
        showToast('已删除');
        closeView();
        loadMails();
    } catch (e) { showToast('删除失败: ' + e.message, true); }
}

// ============================================================
// 写邮件
// ============================================================
function openCompose() {
    $('composeTo').value = '';
    $('composeSubject').value = '';
    $('composeHtml').value = '';
    $('composePreview').innerHTML = '';
    attachments = [];
    renderAttachmentList();
    document.getElementById('composeAttachment').value = '';
    $('composeModal').classList.add('active');
}

function closeCompose() { $('composeModal').classList.remove('active'); }

// ============================================================
// 附件相关
// ============================================================
let attachments = [];

function addAttachments() {
    const input = document.getElementById('composeAttachment');
    const files = input.files;
    if (!files || files.length === 0) {
        showToast('请先选择文件', true);
        return;
    }

    for (const file of files) {
        const reader = new FileReader();
        reader.onload = function(e) {
            const base64 = e.target.result.split(',')[1];
            attachments.push({
                filename: file.name,
                content: base64
            });
            renderAttachmentList();
            showToast('✅ 已添加: ' + file.name);
        };
        reader.onerror = function() {
            showToast('读取文件失败: ' + file.name, true);
        };
        reader.readAsDataURL(file);
    }
    input.value = '';
}

function renderAttachmentList() {
    const list = document.getElementById('attachmentList');
    if (attachments.length === 0) {
        list.innerHTML = '';
        return;
    }
    list.innerHTML = attachments.map(function(att, index) {
        const sizeKB = (att.content.length * 0.75 / 1024).toFixed(1);
        return '<div style="display:flex;align-items:center;gap:8px;padding:2px 0;border-bottom:1px solid #f0f0f0;">' +
            '<span>📎 ' + escapeHtml(att.filename) + '</span>' +
            '<span style="color:#999;font-size:11px;">(' + sizeKB + ' KB)</span>' +
            '<button data-action="removeAttachment" data-arg="' + index + '" style="margin-left:auto;background:#e74c3c;color:white;border:none;border-radius:4px;padding:0 8px;cursor:pointer;font-size:12px;">✕</button>' +
        '</div>';
    }).join('');
}

function removeAttachment(index) {
    attachments.splice(index, 1);
    renderAttachmentList();
    showToast('已移除');
}

// ============================================================
// 发送邮件（含附件）
// ============================================================
async function sendCompose() {
    const to = $('composeTo').value.trim();
    const subject = $('composeSubject').value.trim();

    if (!resendConfigured) { showToast('⚠️ 请先配置 Resend API Key', true); return; }

    const preview = $('composePreview');
    const previewContent = preview.innerHTML;
    if (!isComposePlaceholder(previewContent)) $('composeHtml').value = previewContent;

    const html = $('composeHtml').value.trim();
    if (!to || !subject || !html) { showToast('请填写完整信息', true); return; }

    const btn = $('composeSendBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> 发送中...';

    try {
        const resp = await fetch('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, html, attachments: attachments })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || '发送失败');
        showToast('✅ 邮件已发送 (ID: ' + data.id + ')');
        attachments = [];
        renderAttachmentList();
        document.getElementById('composeAttachment').value = '';
        closeCompose();
        loadMails();
    } catch (e) { showToast('发送失败: ' + e.message, true); }
    finally { btn.disabled = false; btn.innerHTML = '📤 发送'; }
}

// ============================================================
// Web Push 订阅
// ============================================================
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

async function subscribePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        showToast('当前浏览器不支持推送通知', true);
        return;
    }
    try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            showToast('你拒绝了通知权限', true);
            return;
        }
        const keyResp = await fetch('/push/vapid-public-key');
        const { publicKey } = await keyResp.json();
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
        await fetch('/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription)
        });
        showToast('✅ 已开启推送通知');
    } catch (e) {
        console.error('推送订阅失败:', e);
        showToast('推送订阅失败: ' + e.message, true);
    }
}

async function unsubscribePush() {
    try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js');
        if (registration) {
            const subscription = await registration.pushManager.getSubscription();
            if (subscription) await subscription.unsubscribe();
        }
        await fetch('/push/unsubscribe', { method: 'POST' });
        showToast('已关闭推送通知');
    } catch (e) {
        showToast('关闭失败: ' + e.message, true);
    }
}

// ============================================================
// 打开写邮件弹窗并填入收件人（mailto 支持）
// ============================================================
function openComposeWithTo(to) {
    if ($('mainApp').style.display === 'none') {
        setTimeout(() => openComposeWithTo(to), 500);
        return;
    }
    openCompose();
    let email = to.replace(/^mailto:/i, '');
    let subject = '';
    let body = '';
    const parts = email.split('?');
    email = decodeURIComponent(parts[0] || '');
    if (parts[1]) {
        const params = new URLSearchParams(parts[1]);
        subject = params.get('subject') || '';
        body = params.get('body') || '';
    }
    if (email) $('composeTo').value = email;
    if (subject) $('composeSubject').value = subject;
    if (body) {
        // mailto 的 body 完全来自 URL，以前直接进 innerHTML —— 打开一条链接就能执行脚本。
        // 这里当纯文本处理：先转义再换行。
        const bodyHtml = textToHtml(body);
        $('composeHtml').value = bodyHtml;
        $('composePreview').innerHTML = bodyHtml;
    }
}

// ============================================================
// 初始化
// ============================================================
async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const mailtoTo = urlParams.get('to');

    // 会话 Cookie 是 HttpOnly 的，JS 读不到，只能靠 /user/info 判断登录状态
    try {
        const resp = await fetch('/user/info');
        if (resp.ok) {
            const userData = await resp.json();
            if (userData && userData.success) {
                await loadMainApp();
                if (mailtoTo) openComposeWithTo(mailtoTo);
                else {
                    const pending = sessionStorage.getItem('pendingMailto');
                    if (pending) {
                        sessionStorage.removeItem('pendingMailto');
                        openComposeWithTo(pending);
                    }
                }
                return;
            }
        }
    } catch { /* 未登录或网络问题，走登录页 */ }

    if (mailtoTo) sessionStorage.setItem('pendingMailto', mailtoTo);
    try {
        const resp = await fetch('/no-login/info');
        const data = await resp.json();
        if (data.title) document.title = data.title;
        if (data.account) $('loginHint').textContent = '管理员账号：' + data.account;
    } catch { /* ignore */ }
    $('loginPage').style.display = 'flex';
    $('registerPage').style.display = 'none';
}

// ============================================================
// 写邮件：源码与预览双向同步
// ============================================================
function setupEditorSync() {
    const textarea = document.getElementById('composeHtml');
    const preview = document.getElementById('composePreview');

    if (textarea) {
        textarea.addEventListener('input', function() {
            const html = textarea.value;
            // 清空即可，提示交给 CSS，不要把提示文字写进内容里
            preview.innerHTML = html.trim() ? html : '';
        });
    }

    if (preview) {
        preview.addEventListener('input', function() {
            let html = preview.innerHTML;
            if (isComposePlaceholder(html)) {
                // 浏览器把内容删空后常常留下一个 <br>，去掉它 :empty 才会生效
                if (html !== '') { preview.innerHTML = ''; html = ''; }
                textarea.value = '';
                return;
            }
            textarea.value = html;
        });
    }
}

// ============================================================
// 事件绑定
// ============================================================
// 统一用事件委托处理所有按钮：内联 onclick 已被移除以配合 CSP 的 script-src 'self'
document.addEventListener('click', function(e) {
    const target = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!target) return;
    const action = target.dataset.action;
    const fn = window[action];
    if (typeof fn !== 'function') return;
    e.preventDefault();
    fn(target.dataset.arg, target);
});

document.addEventListener('DOMContentLoaded', function() {
    init();
    setupEditorSync();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const loginPage = $('loginPage');
        const registerPage = $('registerPage');
        if (loginPage && loginPage.style.display !== 'none') login();
        else if (registerPage && registerPage.style.display !== 'none') register();
    }
});`;
            return new Response(js, {
                headers: {
                    'Content-Type': 'application/javascript; charset=utf-8',
                    // 必须 no-cache：客户端与接口的契约会随版本变化（例如登录字段），
                    // 如果浏览器缓存了旧 app.js，就会出现「旧前端 + 新后端」直接登不上。
                    'Cache-Control': 'no-cache'
                },
            });
        }

        return Response.json({ error: '未找到该路由' }, { status: 404 });
    },
};

export default {
    email: worker.email,
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        return withSecurityHeaders(await worker.fetch(request, env, ctx));
    },
};

