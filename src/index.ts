import { Env, StoredEmail } from './types';
import { parseEmail } from './email-parser';
import { sendAutoReply, sendEmail } from './resend-client';

// ===== HTML 前端模板 =====
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>📧 邮件管理</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
            color: #1a1a2e;
            padding: 20px;
        }
        .app {
            max-width: 1200px;
            margin: 0 auto;
        }
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
        }
        .container {
            display: grid;
            grid-template-columns: 320px 1fr;
            gap: 24px;
        }
        @media (max-width: 768px) {
            .container { grid-template-columns: 1fr; }
        }
        .sidebar {
            background: white;
            border-radius: 16px;
            padding: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
            height: fit-content;
            position: sticky;
            top: 20px;
        }
        .sidebar h2 {
            font-size: 16px;
            color: #666;
            margin-bottom: 12px;
            letter-spacing: 0.5px;
        }
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
        .compose-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 4px 16px rgba(102, 126, 234, 0.4);
        }
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
        .stat-item .num {
            font-size: 22px;
            font-weight: 700;
            color: #667eea;
        }
        .stat-item .label {
            font-size: 12px;
            color: #999;
            margin-top: 2px;
        }
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
        .mail-item .info {
            flex: 1;
            min-width: 0;
        }
        .mail-item .info .from {
            font-weight: 600;
            font-size: 14px;
        }
        .mail-item .info .subject {
            font-size: 13px;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .mail-item .info .time {
            font-size: 12px;
            color: #999;
        }
        .mail-item .status-badge {
            font-size: 11px;
            padding: 2px 10px;
            border-radius: 12px;
            background: #e8f5e9;
            color: #2e7d32;
            flex-shrink: 0;
        }
        .mail-item .status-badge.replied {
            background: #e3f2fd;
            color: #1565c0;
        }
        .empty-state {
            padding: 60px 20px;
            text-align: center;
            color: #999;
        }
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
            max-width: 600px;
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
        .modal input:focus, .modal textarea:focus {
            outline: none;
            border-color: #667eea;
        }
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

        .mode-toggle {
            display: flex;
            gap: 8px;
            margin-top: 4px;
        }
        .mode-toggle button {
            padding: 2px 14px;
            border-radius: 4px;
            border: 1px solid #ccc;
            background: #fff;
            color: #333;
            cursor: pointer;
            font-size: 12px;
            transition: all 0.15s;
        }
        .mode-toggle button.active {
            background: #667eea;
            color: #fff;
            border-color: #667eea;
        }
        .mode-toggle button:hover { opacity: 0.8; }
        .preview-box {
            display: none;
            min-height: 120px;
            padding: 12px;
            border: 2px solid #e8ecf4;
            border-radius: 10px;
            background: #fafbfc;
            overflow-y: auto;
            line-height: 1.7;
        }
        .preview-box.show { display: block; }
        .compose-textarea { display: block; }
        .compose-textarea.hide { display: none; }
    </style>
</head>
<body>
<div class="app">
    <header>
        <h1>📧 邮件管理</h1>
        <span class="badge" id="domainBadge">loading...</span>
    </header>

    <div class="container">
        <div class="sidebar">
            <button class="compose-btn" onclick="openCompose()">✏️ 写新邮件</button>
            <h2>📊 统计</h2>
            <div class="stats">
                <div class="stat-item">
                    <div class="num" id="totalCount">0</div>
                    <div class="label">总邮件</div>
                </div>
                <div class="stat-item">
                    <div class="num" id="repliedCount">0</div>
                    <div class="label">已回复</div>
                </div>
            </div>
            <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #eee;">
                <p style="font-size:13px; color:#999; line-height:1.6;">
                    💡 点击邮件查看详情<br/>
                    🔄 自动刷新每 30 秒
                </p>
            </div>
        </div>

        <div class="mail-list">
            <div class="mail-list-header">
                <h2>📥 收件箱</h2>
                <button class="refresh-btn" onclick="loadMails()" title="刷新">⟳</button>
            </div>
            <div id="mailList">
                <div class="empty-state">
                    <div class="icon">📭</div>
                    <p>暂无邮件</p>
                </div>
            </div>
        </div>
    </div>
</div>

<!-- 写邮件弹窗 -->
<div class="modal-overlay" id="composeModal">
    <div class="modal">
        <div class="modal-header">
            <h3>✏️ 写邮件</h3>
            <button class="modal-close" onclick="closeCompose()">×</button>
        </div>
        <label>收件人</label>
        <input id="composeTo" placeholder="someone@example.com" />
        <label>主题</label>
        <input id="composeSubject" placeholder="邮件主题" />
        <label>
            <span>内容</span>
            <span class="mode-toggle">
                <button id="srcBtn" class="active" onclick="setComposeMode('src')">源码</button>
                <button id="previewBtn" onclick="setComposeMode('preview')">预览</button>
            </span>
        </label>
        <textarea id="composeHtml" class="compose-textarea" placeholder="邮件内容（支持 HTML）"></textarea>
        <div id="composePreview" class="preview-box"></div>
        <button class="send-btn" id="composeSendBtn" onclick="sendCompose()">📤 发送</button>
    </div>
</div>

<!-- 查看邮件弹窗 -->
<div class="modal-overlay" id="viewModal">
    <div class="modal" style="max-width: 700px;">
        <div class="modal-header">
            <h3 id="viewSubject">邮件详情</h3>
            <button class="modal-close" onclick="closeView()">×</button>
        </div>
        <div style="font-size:14px; color:#666; margin-bottom:8px;">
            <strong>发件人：</strong><span id="viewFrom">-</span>
        </div>
        <div style="font-size:14px; color:#666; margin-bottom:16px;">
            <strong>时间：</strong><span id="viewTime">-</span>
        </div>
        <div id="viewBody" style="background:#f8f9fc; padding:16px; border-radius:10px; min-height:100px; white-space:pre-wrap; line-height:1.7;">
            -
        </div>
        <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="send-btn" style="flex:1; background:#667eea;" onclick="replyFromView()">💬 回复</button>
            <button class="send-btn" style="flex:1; background:#e74c3c;" onclick="deleteFromView()">🗑️ 删除</button>
        </div>
    </div>
</div>

<!-- Toast -->
<div class="toast" id="toast"></div>

<script>
let mails = [];
let currentViewId = null;
let refreshInterval = null;
let composeMode = 'src';

const $ = id => document.getElementById(id);
const mailListEl = $('mailList');
const domainBadge = $('domainBadge');

function showToast(msg, isError = false) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    clearTimeout(t._hide);
    t._hide = setTimeout(() => t.classList.remove('show'), 3000);
}

// ===== 源码/预览模式切换 =====
function setComposeMode(mode) {
    composeMode = mode;
    const srcBtn = $('srcBtn');
    const previewBtn = $('previewBtn');
    const textarea = $('composeHtml');
    const preview = $('composePreview');

    if (mode === 'src') {
        srcBtn.className = 'active';
        previewBtn.className = '';
        textarea.className = 'compose-textarea';
        preview.className = 'preview-box';
        // 预览内容同步到 textarea
        if (preview.innerHTML && preview.innerHTML !== '（空内容）') {
            textarea.value = preview.innerHTML;
        }
    } else {
        previewBtn.className = 'active';
        srcBtn.className = '';
        textarea.className = 'compose-textarea hide';
        preview.className = 'preview-box show';
        // 渲染内容
        const val = textarea.value.trim();
        preview.innerHTML = val || '（空内容）';
    }
}

// ===== 加载邮件列表 =====
async function loadMails() {
    try {
        const resp = await fetch('/mails');
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        mails = data.mails || [];
        renderMails();
        updateStats();
    } catch (e) {
        showToast('加载邮件失败: ' + e.message, true);
    }
}

function renderMails() {
    if (mails.length === 0) {
        mailListEl.innerHTML = \`
            <div class="empty-state">
                <div class="icon">📭</div>
                <p>收件箱空空如也</p>
            </div>
        \`;
        return;
    }
    mailListEl.innerHTML = mails.map(m => \`
        <div class="mail-item" onclick="viewMail('\${encodeURIComponent(m.id)}')">
            <div class="avatar">\${(m.from || '?')[0].toUpperCase()}</div>
            <div class="info">
                <div class="from">\${escapeHtml(m.from)}</div>
                <div class="subject">\${escapeHtml(m.subject || '(无主题)')}</div>
                <div class="time">\${formatTime(m.timestamp)}</div>
            </div>
            <span class="status-badge \${m.status === 'replied' ? 'replied' : ''}">
                \${m.status === 'replied' ? '✅ 已回复' : '📩 未读'}
            </span>
        </div>
    \`).join('');
}

function updateStats() {
    $('totalCount').textContent = mails.length;
    $('repliedCount').textContent = mails.filter(m => m.status === 'replied').length;
}

// ===== 查看邮件 =====
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
        $('viewModal').classList.add('active');
    } catch (e) {
        showToast('加载邮件详情失败', true);
    }
}

function closeView() {
    $('viewModal').classList.remove('active');
    currentViewId = null;
}

function replyFromView() {
    if (!currentViewId) return;
    const mail = mails.find(m => m.id === currentViewId);
    if (!mail) return;
    closeView();
    $('composeTo').value = mail.from;
    $('composeSubject').value = 'Re: ' + (mail.subject || '');
    $('composeHtml').value = '\\n\\n--- 原始邮件 ---\\n' + (mail.text || '');
    setComposeMode('src');
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
    } catch (e) {
        showToast('删除失败: ' + e.message, true);
    }
}

// ===== 写邮件 =====
function openCompose() {
    $('composeTo').value = '';
    $('composeSubject').value = '';
    $('composeHtml').value = '';
    $('composePreview').innerHTML = '';
    setComposeMode('src');
    $('composeModal').classList.add('active');
}

function closeCompose() {
    $('composeModal').classList.remove('active');
}

async function sendCompose() {
    const to = $('composeTo').value.trim();
    const subject = $('composeSubject').value.trim();
    
    // 如果当前是预览模式，把预览内容同步回 textarea
    if (composeMode === 'preview') {
        const previewContent = $('composePreview').innerHTML;
        if (previewContent && previewContent !== '（空内容）') {
            $('composeHtml').value = previewContent;
        }
    }
    
    const html = $('composeHtml').value.trim();
    
    if (!to || !subject || !html) {
        showToast('请填写完整信息', true);
        return;
    }
    const btn = $('composeSendBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="loading-spinner"></span> 发送中...';
    try {
        const resp = await fetch('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, subject, html })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || '发送失败');
        showToast('✅ 邮件已发送 (ID: ' + data.id + ')');
        closeCompose();
        loadMails();
    } catch (e) {
        showToast('发送失败: ' + e.message, true);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '📤 发送';
    }
}

// ===== 工具函数 =====
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

async function loadDomain() {
    try {
        const resp = await fetch('/domain');
        const data = await resp.json();
        domainBadge.textContent = '📧 ' + data.domain;
    } catch { domainBadge.textContent = '📧 未知域名'; }
}

// ===== 初始化 =====
loadDomain();
loadMails();
refreshInterval = setInterval(loadMails, 30000);

document.querySelectorAll('.modal-overlay').forEach(el => {
    el.addEventListener('click', (e) => {
        if (e.target === el) {
            el.classList.remove('active');
        }
    });
});
</script>
</body>
</html>`;

// ============================================================
// Worker 主入口
// ============================================================

export default {
    async email(message: EmailMessage, env: Env, ctx: ExecutionContext) {
        console.log(`📨 收到邮件: from=${message.from}, to=${message.to}`);

        try {
            const raw = await new Response(message.raw).arrayBuffer();
            const parsed = await parseEmail(raw);
            const messageId = message.headers.get('Message-ID') || crypto.randomUUID();

            const emailData: StoredEmail = {
                id: messageId,
                from: parsed.from,
                to: parsed.to,
                subject: parsed.subject,
                timestamp: new Date().toISOString(),
                text: parsed.text,
                html: parsed.html,
                status: 'received',
            };

            // 存储邮件
            await env.EMAIL.put(messageId, JSON.stringify(emailData), {
                expirationTtl: 30 * 24 * 60 * 60,
            });

            // 维护邮件 ID 列表
            const idsJson = await env.EMAIL.get('_mail_ids');
            let ids: string[] = idsJson ? JSON.parse(idsJson) : [];
            ids.push(messageId);
            if (ids.length > 500) {
                const toRemove = ids.slice(0, ids.length - 500);
                for (const oldId of toRemove) {
                    await env.EMAIL.delete(oldId);
                }
                ids = ids.slice(-500);
            }
            await env.EMAIL.put('_mail_ids', JSON.stringify(ids));

            // 发送自动回复
            await sendAutoReply(
                env.RESEND_API_KEY,
                env.DOMAIN,
                parsed.from,
                parsed.subject
            );

            // 更新状态
            const updated = { ...emailData, status: 'replied' as const };
            await env.EMAIL.put(messageId, JSON.stringify(updated));

            console.log(`✅ 邮件已存储并回复`);
        } catch (error) {
            console.error('❌ 处理邮件失败:', error);
        }
    },

    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        const path = url.pathname;

        // 首页
        if (path === '/' || path === '') {
            return new Response(HTML_TEMPLATE, {
                headers: { 'Content-Type': 'text/html; charset=utf-8' },
            });
        }

        // 获取域名
        if (path === '/domain') {
            return Response.json({ domain: env.DOMAIN });
        }

        // 获取邮件列表
        if (path === '/mails' && request.method === 'GET') {
            const idsJson = await env.EMAIL.get('_mail_ids');
            const ids: string[] = idsJson ? JSON.parse(idsJson) : [];
            const recentIds = ids.slice(-50).reverse();
            const mails: StoredEmail[] = [];
            for (const id of recentIds) {
                const data = await env.EMAIL.get(id);
                if (data) {
                    try {
                        mails.push(JSON.parse(data));
                    } catch {
                        // ignore
                    }
                }
            }
            return Response.json({ mails });
        }

        // 发送邮件
        if (path === '/send' && request.method === 'POST') {
            try {
                const body = (await request.json()) as {
                    to: string | string[];
                    subject: string;
                    html: string;
                    text?: string;
                };
                const result = await sendEmail(
                    env.RESEND_API_KEY,
                    `noreply@${env.DOMAIN}`,
                    body.to,
                    body.subject,
                    body.html,
                    body.text
                );
                return Response.json({ success: true, id: result.id });
            } catch (error) {
                return Response.json(
                    { success: false, error: String(error) },
                    { status: 500 }
                );
            }
        }

        // 获取单封邮件（URL 解码）
        if (path.startsWith('/mail/') && request.method === 'GET') {
            const id = decodeURIComponent(path.split('/')[2]);
            if (!id) {
                return Response.json({ error: '缺少邮件 ID' }, { status: 400 });
            }
            const data = await env.EMAIL.get(id);
            if (!data) {
                return Response.json({ error: '邮件不存在' }, { status: 404 });
            }
            return Response.json(JSON.parse(data));
        }

        // 删除邮件（URL 解码）
        if (path.startsWith('/mail/') && request.method === 'DELETE') {
            const id = decodeURIComponent(path.split('/')[2]);
            if (!id) {
                return Response.json({ error: '缺少邮件 ID' }, { status: 400 });
            }
            const idsJson = await env.EMAIL.get('_mail_ids');
            let ids: string[] = idsJson ? JSON.parse(idsJson) : [];
            ids = ids.filter((i) => i !== id);
            await env.EMAIL.put('_mail_ids', JSON.stringify(ids));
            await env.EMAIL.delete(id);
            return Response.json({ success: true });
        }

        return Response.json({ error: '未找到该路由' }, { status: 404 });
    },
};
