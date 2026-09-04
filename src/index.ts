import { Env, StoredEmail } from './types';
import { parseEmail } from './email-parser';
import { sendAutoReply, sendEmail } from './resend-client';
import { sha256 } from './utils';
import { saveAttachments, getAttachment, deleteAttachments } from './attachment';
import {
    getUser,
    createUser,
    userExists,
    createSession,
    getSession,
    destroySession,
    hasAdmin,
    setAdminExists,
} from './auth';
import {
    getAdminPasswordHash,
    setAdminPasswordHash,
    verifyAdminPassword,
    verifyRegCode,
    generateRegCode,
    getAdminSettings,
    saveAdminSettings,
    getSenderPrefix,
    setSenderPrefix,
} from './admin';

import template from './template.html';

const HTML_TEMPLATE = template;

// ============================================================
// Worker 主入口
// ============================================================

export default {
    async email(message: any, env: Env, ctx: ExecutionContext) {
        console.log(`📨 收到邮件: from=${message.from}, to=${message.to}`);

        try {
            const raw = await new Response(message.raw).arrayBuffer();
            const parsed = await parseEmail(raw);

            // 生成纯字母数字的 ID
            const messageId = Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);

            // 垃圾邮件拦截
            if (parsed.isSpam) {
                console.log(`🚫 垃圾邮件已拦截: from=${parsed.from}, subject=${parsed.subject}`);
                return;
            }

            // 保存附件到 R2
            const attachments = await saveAttachments(env, parsed.attachments, messageId);

            if (parsed.hasScript) {
                console.log(`📝 邮件含 <script> 标签，已移除标签及内容: from=${parsed.from}`);
            }

            const emailData: StoredEmail = {
                id: messageId,
                from: parsed.from,
                to: parsed.to,
                subject: parsed.subject,
                timestamp: new Date().toISOString(),
                text: parsed.text,
                html: parsed.html,
                attachments: attachments,
                status: 'received',
            };

            await env.EMAIL.put(messageId, JSON.stringify(emailData), { expirationTtl: 30 * 24 * 60 * 60 });

            // 全局邮件索引
            const idsJson = await env.EMAIL.get('_mail_ids');
            let ids: string[] = idsJson ? JSON.parse(idsJson) : [];
            ids.push(messageId);
            if (ids.length > 500) {
                const toRemove = ids.slice(0, ids.length - 500);
                for (const oldId of toRemove) { await env.EMAIL.delete(oldId); }
                ids = ids.slice(-500);
            }
            await env.EMAIL.put('_mail_ids', JSON.stringify(ids));

            // 用户邮件列表
            const recipients = parsed.to.split(',').map(r => r.trim());
            for (const recipient of recipients) {
                const userListKey = `user:${recipient}:list`;
                const userIdsJson = await env.EMAIL_USER.get(userListKey);
                let userIds: string[] = userIdsJson ? JSON.parse(userIdsJson) : [];
                userIds.push(messageId);
                if (userIds.length > 500) userIds = userIds.slice(-500);
                await env.EMAIL_USER.put(userListKey, JSON.stringify(userIds));
            }

            // 自动回复（检查开关）
            const autoReplyEnabled = await env.EMAIL_USER.get('admin:auto_reply') !== 'false';
            if (env.RESEND_API_KEY && autoReplyEnabled) {
                const prefix = await env.EMAIL_USER.get('admin:sender_prefix') || 'noreply';
                const sender = `${prefix}@${env.DOMAIN}`;
                await sendAutoReply(env.RESEND_API_KEY, sender, parsed.from, parsed.subject);
                const updated = { ...emailData, status: 'replied' as const };
                await env.EMAIL.put(messageId, JSON.stringify(updated));
                console.log('✅ 邮件已存储并自动回复');
            } else {
                console.log(`✅ 邮件已存储（自动回复: ${autoReplyEnabled ? '已配置 Resend' : '已关闭'}）`);
            }
        } catch (error) {
            console.error('❌ 处理邮件失败:', error);
        }
    },

    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        const path = url.pathname;

        async function getSessionFromCookie() {
            const cookie = request.headers.get('Cookie') || '';
            const sessionId = cookie.match(/session=([^;]+)/)?.[1];
            if (!sessionId) return null;
            return await getSession(env, sessionId);
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
        // 获取用户信息
        // ============================================================
        if (path === '/user/info') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ success: false, error: '未登录' }, { status: 401 });
            return Response.json({ success: true, email: session.email, role: session.role });
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
                const body = await request.json() as { email: string; password_hash: string; regCode: string };
                const { email, password_hash, regCode } = body;

                const hasAdminUser = await env.EMAIL_USER.get('_admin_exists') === 'true';

                if (hasAdminUser) {
                    if (!regCode) return Response.json({ success: false, error: '请输入注册码' }, { status: 400 });
                    const regCodeHash = await sha256(regCode);
                    const stored = await env.EMAIL_USER.get('admin:regcode_hash');
                    if (stored !== regCodeHash) {
                        return Response.json({ success: false, error: '注册码错误' }, { status: 400 });
                    }
                }

                if (await userExists(env, email)) {
                    return Response.json({ success: false, error: '该邮箱已注册' }, { status: 400 });
                }

                const role = hasAdminUser ? 'user' : 'admin';
                await createUser(env, email, password_hash, role);

                if (!hasAdminUser) {
                    await setAdminExists(env, true);
                    await generateRegCode(env);
                }

                return Response.json({ success: true, role });
            } catch (error) {
                return Response.json({ success: false, error: String(error) }, { status: 500 });
            }
        }

        // ============================================================
        // 登录
        // ============================================================
        if (path === '/login' && request.method === 'POST') {
            try {
                const body = await request.json() as { email: string; password_hash: string };
                const { email, password_hash } = body;

                const user = await getUser(env, email);
                if (!user) return Response.json({ success: false, error: '用户不存在' }, { status: 400 });
                if (user.password_hash !== password_hash) {
                    return Response.json({ success: false, error: '密码错误' }, { status: 400 });
                }

                const sessionId = await createSession(env, email, user.role);
                return Response.json({ success: true, role: user.role, sessionId });
            } catch (error) {
                return Response.json({ success: false, error: String(error) }, { status: 500 });
            }
        }

        // ============================================================
        // 退出
        // ============================================================
        if (path === '/logout' && request.method === 'POST') {
            const cookie = request.headers.get('Cookie') || '';
            const sessionId = cookie.match(/session=([^;]+)/)?.[1];
            if (sessionId) await destroySession(env, sessionId);
            return Response.json({ success: true });
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

                const body = await request.json() as { title: string; senderPrefix: string; autoReply: boolean; password_hash?: string };
                await saveAdminSettings(env, body.title, body.senderPrefix, body.autoReply);
                if (body.password_hash) await setAdminPasswordHash(env, body.password_hash);
                return Response.json({ success: true });
            } catch (error) {
                return Response.json({ success: false, error: String(error) }, { status: 500 });
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
            const id = decodeURIComponent(path.replace('/download/', ''));
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
            const mail = JSON.parse(mailData) as StoredEmail;

            if (session.role !== 'admin' && mail.to !== session.email) {
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

            return new Response(attachment.content, {
                headers: {
                    'Content-Type': attachment.contentType,
                    'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
                },
            });
        }

        // ============================================================
        // 下载附件（通过 key）
        // ============================================================
        if (path.startsWith('/attachments/') && request.method === 'GET') {
            const key = decodeURIComponent(path.replace('/attachments/', ''));
            if (!key) {
                return Response.json({ error: '缺少附件 ID' }, { status: 400 });
            }

            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            const attachment = await getAttachment(env, key);
            if (!attachment) {
                return Response.json({ error: '附件不存在' }, { status: 404 });
            }

            const messageId = key.split('/')[0];
            const mailData = await env.EMAIL.get(messageId);
            if (!mailData) {
                return Response.json({ error: '邮件不存在' }, { status: 404 });
            }
            const mail = JSON.parse(mailData) as StoredEmail;
            if (session.role !== 'admin' && mail.to !== session.email) {
                return Response.json({ error: '无权下载' }, { status: 403 });
            }

            return new Response(attachment.content, {
                headers: {
                    'Content-Type': attachment.contentType,
                    'Content-Disposition': `attachment; filename="${encodeURIComponent(attachment.filename)}"`,
                },
            });
        }

        // ============================================================
        // 获取邮件列表
        // ============================================================
        if (path === '/mails' && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            let ids: string[] = [];
            if (session.role === 'admin') {
                const idsJson = await env.EMAIL.get('_mail_ids');
                ids = idsJson ? JSON.parse(idsJson) : [];
            } else {
                const userListKey = `user:${session.email}:list`;
                const idsJson = await env.EMAIL_USER.get(userListKey);
                ids = idsJson ? JSON.parse(idsJson) : [];
            }

            const recentIds = ids.slice(-50).reverse();
            const mails: StoredEmail[] = [];
            for (const id of recentIds) {
                const data = await env.EMAIL.get(id);
                if (data) {
                    try { mails.push(JSON.parse(data)); } catch { /* ignore */ }
                }
            }
            return Response.json({ mails });
        }

        // ============================================================
        // 获取单封邮件
        // ============================================================
        if (path.startsWith('/mail/') && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            const id = decodeURIComponent(path.split('/')[2]);
            if (!id) return Response.json({ error: '缺少邮件 ID' }, { status: 400 });

            const data = await env.EMAIL.get(id);
            if (!data) return Response.json({ error: '邮件不存在' }, { status: 404 });

            const mail = JSON.parse(data) as StoredEmail;
            if (session.role !== 'admin') {
                const userEmail = session.email;
                if (mail.from !== userEmail && mail.to !== userEmail) {
                    return Response.json({ error: '无权查看' }, { status: 403 });
                }
            }
            return Response.json(mail);
        }

        // ============================================================
        // 删除邮件（同时删除附件）
        // ============================================================
        if (path.startsWith('/mail/') && request.method === 'DELETE') {
            const session = await getSessionFromCookie();
            if (!session) return Response.json({ error: '未登录' }, { status: 401 });

            const id = decodeURIComponent(path.split('/')[2]);
            if (!id) return Response.json({ error: '缺少邮件 ID' }, { status: 400 });

            const data = await env.EMAIL.get(id);
            if (!data) return Response.json({ error: '邮件不存在' }, { status: 404 });

            const mail = JSON.parse(data) as StoredEmail;
            if (session.role !== 'admin') {
                if (mail.to !== session.email) {
                    return Response.json({ error: '无权删除' }, { status: 403 });
                }
            }

            await env.EMAIL.delete(id);

            if (mail.attachments && mail.attachments.length > 0) {
                await deleteAttachments(env, id);
            }

            const idsJson = await env.EMAIL.get('_mail_ids');
            let ids: string[] = idsJson ? JSON.parse(idsJson) : [];
            ids = ids.filter(i => i !== id);
            await env.EMAIL.put('_mail_ids', JSON.stringify(ids));

            if (session.role !== 'admin') {
                const userListKey = `user:${session.email}:list`;
                const userIdsJson = await env.EMAIL_USER.get(userListKey);
                let userIds: string[] = userIdsJson ? JSON.parse(userIdsJson) : [];
                userIds = userIds.filter(i => i !== id);
                await env.EMAIL_USER.put(userListKey, JSON.stringify(userIds));
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
                const prefix = await env.EMAIL_USER.get('admin:sender_prefix') || 'noreply';
                const sender = `${prefix}@${env.DOMAIN}`;
                const result = await sendEmail(
                    env.RESEND_API_KEY,
                    sender,
                    body.to,
                    body.subject,
                    body.html,
                    body.text,
                    body.attachments
                );
                return Response.json({ success: true, id: result.id });
            } catch (error) {
                return Response.json({ success: false, error: String(error) }, { status: 500 });
            }
        }

        // ============================================================
        // 首页
        // ============================================================
        if (path === '/' || path === '') {
            return new Response(HTML_TEMPLATE, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        return Response.json({ error: '未找到该路由' }, { status: 404 });
    },
};
