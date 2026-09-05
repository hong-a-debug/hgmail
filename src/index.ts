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
            border-radius: 20px;
            max-width: 700px;
            width: 95%;
            max-height: 90vh;
            overflow-y: auto;
            padding: 32px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.2);
            animation: slideUp 0.25s ease;
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
            min-height: 200px;
            margin-top: 4px;
        }
        .editor-split .left { flex: 1; display: flex; flex-direction: column; }
        .editor-split .left textarea {
            flex: 1;
            min-height: 180px;
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
            min-height: 180px;
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
        .editor-split .right .empty-hint { color: #bbb; font-size: 14px; }
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
            .modal { padding: 20px; max-width: 100%; width: 100%; max-height: 95vh; border-radius: 12px; margin: 10px; }
            .modal-header h3 { font-size: 17px; }
            .modal label { font-size: 13px; margin-top: 12px; }
            .modal input, .modal textarea { font-size: 14px; padding: 10px 12px; }
            .modal .send-btn { font-size: 15px; padding: 12px; }
            .editor-split { flex-direction: column; gap: 8px; min-height: auto; }
            .editor-split .left textarea { min-height: 150px; font-size: 14px; }
            .editor-split .right { min-height: 120px; font-size: 14px; }
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
            #viewBody { font-size: 14px; padding: 12px !important; min-height: 80px; }
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
            .modal { padding: 16px; margin: 6px; }
            .auth-box { padding: 16px; }
            .editor-split .left textarea { min-height: 120px; }
            .editor-split .right { min-height: 100px; }
            .admin-panel .field .email-row { flex-direction: column; align-items: stretch; }
            .admin-panel .field .email-row input { width: 100%; flex: none; }
            .admin-panel .field .email-row .domain-part { width: 100%; }
            .admin-panel .field .code-row { flex-direction: column; }
            .admin-panel .field .code-row input { width: 100%; }
            .admin-panel .field .code-row button { width: 100%; justify-content: center; }
        }
        `;
            return new Response(css, {
                headers: { 
                    'Content-Type': 'text/css; charset=utf-8',
                    'Cache-Control': 'public, max-age=86400'
                },
            });
        }

        if (path === '/app.js') {
            const js = `
        // ============================================================
        // 工具函数
        // ============================================================
        const $ = id => document.getElementById(id);

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
        // SHA256
        // ============================================================
        async function sha256(message) {
            const msgBuffer = new TextEncoder().encode(message);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
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
            const password = $('loginPassword').value.trim();
            if (!email || !password) {
                showError('loginError', '请填写完整信息');
                return;
            }
            hideError('loginError');

            const passwordHash = await sha256(password);

            try {
                const resp = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password_hash: passwordHash })
                });
                const data = await resp.json();
                if (!data.success) {
                    showError('loginError', data.error || '登录失败');
                    return;
                }
                document.cookie = 'session=' + data.sessionId + '; path=/; max-age=604800';
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
            const password = $('regPassword').value.trim();
            const regCode = $('regCode').value.trim().toUpperCase();

            if (!email || !password) {
                showError('regError', '请填写邮箱和密码');
                return;
            }
            hideError('regError');

            const hasAdminUser = await checkHasAdmin();
            if (hasAdminUser && !regCode) {
                showError('regError', '请输入注册码');
                return;
            }

            const passwordHash = await sha256(password);

            try {
                const resp = await fetch('/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password_hash: passwordHash, regCode })
                });
                const data = await resp.json();
                if (!data.success) {
                    showError('regError', data.error || '注册失败');
                    return;
                }
                showToast('✅ 注册成功！请登录');
                showLogin();
                $('loginEmail').value = email;
            } catch (e) {
                showError('regError', '网络错误，请重试');
            }
        }

        // ============================================================
        // 退出
        // ============================================================
        async function logout() {
            document.cookie = 'session=; path=/; max-age=0';
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
                const resp = await fetch('/admin/account');
                const data = await resp.json();
                if (data.account) $('loginHint').textContent = '管理员账号：' + data.account;
            } catch { /* ignore */ }

            await loadUserInfo();
            await loadAdminSettings();
            await loadMails();
            await checkResend();
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(loadMails, 30000);
        }

        // ============================================================
        // 加载用户信息（不显示具体管理员账号名）
        // ============================================================
        async function loadUserInfo() {
            try {
                const resp = await fetch('/user/info');
                const data = await resp.json();
                if (data.success) {
                    if (data.role === 'admin') {
                        $('userBadge').textContent = '👤 管理员';
                        $('adminPanel').style.display = 'block';
                    } else {
                        $('userBadge').textContent = '👤 ' + data.email;
                    }
                }
            } catch { /* ignore */ }
        }

        // ============================================================
        // 加载管理员设置（包含域名）
        // ============================================================
        async function loadAdminSettings() {
            try {
                const domainResp = await fetch('/admin/domain');
                const domainData = await domainResp.json();
                const domain = domainData.domain || 'example.com';
                $('adminSenderDomain').textContent = domain;

                const resp = await fetch('/admin/settings');
                const data = await resp.json();
                if (data.success) {
                    $('adminTitle').value = data.title || '';
                    $('adminSenderPrefix').value = data.senderPrefix || 'noreply';
                    $('adminRegCode').value = data.regCode || '暂无注册码';
                    // 加载自动回复状态
                    if (data.autoReply !== undefined) {
                        document.querySelector('input[name="autoReply"][value="' + (data.autoReply ? 'on' : 'off') + '"]').checked = true;
                    }
                    $('headerTitle').textContent = data.title || '📧 邮件管理';
                    document.title = data.title || '📧 邮件管理';
                }
            } catch { /* ignore */ }
        }

        // ============================================================
        // 保存管理员设置
        // ============================================================
        async function saveAdminSettings() {
            const title = $('adminTitle').value.trim();
            const senderPrefix = $('adminSenderPrefix').value.trim();
            const newPassword = $('adminNewPassword').value.trim();
            const autoReply = document.querySelector('input[name="autoReply"]:checked').value === 'on';

            const payload = { title, senderPrefix, autoReply };
            if (newPassword) payload.password_hash = await sha256(newPassword);

            try {
                const resp = await fetch('/admin/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const data = await resp.json();
                if (!data.success) { showToast('保存失败: ' + data.error, true); return; }
                showToast('✅ 设置已保存');
                $('adminNewPassword').value = '';
                await loadAdminSettings();
            } catch (e) { showToast('网络错误', true); }
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
        // 检查 Resend
        // ============================================================
        let resendConfigured = false;
        let refreshInterval = null;

        async function checkResend() {
            try {
                const resp = await fetch('/check-resend');
                const data = await resp.json();
                resendConfigured = data.configured;
                updateSendButtonVisibility();
            } catch {
                resendConfigured = false;
                updateSendButtonVisibility();
            }
        }

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
        let currentViewId = null;
        const mailListEl = $('mailList');

        async function loadMails() {
            try {
                const resp = await fetch('/mails');
                if (!resp.ok) throw new Error('加载失败');
                const data = await resp.json();
                mails = data.mails || [];
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
                var badgeText = m.status === 'replied' ? '✅ 已回复' : '📩 未读';
                html += '<div class="mail-item" data-id="' + m.id + '" onclick="viewMail(this.dataset.id)">';
                html += '  <div class="avatar">' + from[0].toUpperCase() + '</div>';
                html += '  <div class="info">';
                html += '    <div class="from">' + from + '</div>';
                html += '    <div class="subject">' + subject + '</div>';
                html += '    <div class="time">' + time + '</div>';
                html += '  </div>';
                html += '  <span class="status-badge ' + badge + '">' + badgeText + '</span>';
                html += '</div>';
            }
            mailListEl.innerHTML = html;
        }

        function updateStats() {
            $('totalCount').textContent = mails.length;
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
                $('viewBody').innerHTML = mail.html || mail.text || '(无内容)';

                // 显示附件
                const attachments = mail.attachments || [];
                const attachmentContainer = $('viewAttachments');
                const attachmentList = $('attachmentList');
                if (attachments.length > 0) {
                    attachmentContainer.style.display = 'block';
                    attachmentList.innerHTML = attachments.map(function(att) {
                        return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #eee;">' +
                            '<span style="font-size:13px;">📎 ' + escapeHtml(att.filename) + '</span>' +
                            '<span style="font-size:11px;color:#999;">(' + (att.size / 1024).toFixed(1) + ' KB)</span>' +
                            '<a href="/attachments/' + att.key + '" target="_blank" style="font-size:12px;color:#667eea;margin-left:auto;">下载</a>' +
                        '</div>';
                    }).join('');
                } else {
                    attachmentContainer.style.display = 'none';
                }

                // 显示邮件 ID（最下方）
                const modal = document.querySelector('#viewModal .modal');
                let idDisplay = document.getElementById('mailIdDisplay');
                if (!idDisplay) {
                    idDisplay = document.createElement('div');
                    idDisplay.id = 'mailIdDisplay';
                    idDisplay.style.cssText = 'margin-top:12px;padding:8px 12px;background:#f0f2f5;border-radius:6px;font-size:12px;color:#666;word-break:break-all;border:1px solid #e8ecf4;';
                    modal.appendChild(idDisplay);
                }
                idDisplay.innerHTML = '📋 邮件ID：<span style="user-select:all;cursor:pointer;color:#333;">' + mail.id + '</span>';

                $('viewModal').classList.add('active');
            } catch (e) { showToast('加载邮件详情失败', true); }
        }

        function closeView() {
            $('viewModal').classList.remove('active');
            currentViewId = null;
        }

        function replyFromView() {
            if (!currentViewId) return;
            checkResend().then(() => {
                if (!resendConfigured) { showToast('⚠️ 请先配置 Resend API Key', true); return; }
                const mail = mails.find(m => m.id === currentViewId);
                if (!mail) return;
                closeView();
                $('composeTo').value = mail.from;
                $('composeSubject').value = 'Re: ' + (mail.subject || '');
                const replyContent = '<br><br>--- 原始邮件 ---<br>' + (mail.text || '').replace(/\\n/g, '<br>');
                $('composeHtml').value = replyContent;
                $('composePreview').innerHTML = replyContent;
                $('composeModal').classList.add('active');
            });
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
            checkResend();
            $('composeTo').value = '';
            $('composeSubject').value = '';
            $('composeHtml').value = '';
            $('composePreview').innerHTML = '👈 左边写源码，或直接在右边编辑文字';
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
                    '<button onclick="removeAttachment(' + index + ')" style="margin-left:auto;background:#e74c3c;color:white;border:none;border-radius:4px;padding:0 8px;cursor:pointer;font-size:12px;">✕</button>' +
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
            const placeholder = '👈 左边写源码，或直接在右边编辑文字';
            if (previewContent && previewContent.trim() !== placeholder) $('composeHtml').value = previewContent;

            const html = $('composeHtml').value.trim();
            if (!to || !subject || !html) { showToast('请填写完整信息', true); return; }

            const btn = $('composeSendBtn');
            btn.disabled = true;
            btn.innerHTML = '<span class="loading-spinner"></span> 发送中...';

            try {
                const resp = await fetch('/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to,
                        subject,
                        html,
                        attachments: attachments
                    })
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
        // 初始化
        // ============================================================
        async function init() {
            const sessionId = document.cookie.match(/session=([^;]+)/)?.[1];
            if (sessionId) {
                try {
                    const resp = await fetch('/user/info');
                    if (resp.ok) { loadMainApp(); return; }
                } catch { /* ignore */ }
            }
            $('loginPage').style.display = 'flex';
            $('registerPage').style.display = 'none';
            try {
                const resp = await fetch('/admin/account');
                const data = await resp.json();
                if (data.account) $('loginHint').textContent = '管理员账号：' + data.account;
            } catch { /* ignore */ }
        }

        document.addEventListener('DOMContentLoaded', init);

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                if ($('loginPage').style.display !== 'none') login();
                else if ($('registerPage').style.display !== 'none') register();
            }
        });
        `;
            return new Response(js, {
                headers: { 
                    'Content-Type': 'application/javascript; charset=utf-8',
                    'Cache-Control': 'public, max-age=86400'
                },
            });
        }

        return Response.json({ error: '未找到该路由' }, { status: 404 });
    },
};
