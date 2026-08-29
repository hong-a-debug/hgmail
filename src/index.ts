import { Env, StoredEmail } from './types';
import { parseEmail } from './email-parser';
import { sendAutoReply, sendEmail } from './resend-client';
import { sha256 } from './utils';
import {
    getUser,
    createUser,
    userExists,
    createSession,
    getSession,
    destroySession,
    hasAdmin,
    setAdminExists,
    updateUserRole
} from './auth';
import {
    getAdminPasswordHash,
    setAdminPasswordHash,
    verifyAdminPassword,
    getRegCodeHash,
    setRegCodeHash,
    verifyRegCode,
    generateRegCode,
    getAdminSettings,
    saveAdminSettings
} from './admin';

// ============================================================
// HTML 前端模板
// ============================================================
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title id="pageTitle">📧 邮件管理</title>
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
        .modal input {
            width: 100%;
            padding: 10px 14px;
            border: 2px solid #e8ecf4;
            border-radius: 10px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.15s;
        }
        .modal input:focus {
            outline: none;
            border-color: #667eea;
        }
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
        .editor-split .left {
            flex: 1;
            display: flex;
            flex-direction: column;
        }
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
        .editor-split .left textarea:focus {
            outline: none;
            border-color: #667eea;
        }
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
        .editor-split .right:focus {
            border-color: #667eea;
        }
        .editor-split .right .empty-hint {
            color: #bbb;
            font-size: 14px;
        }
        .editor-label {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 16px;
            margin-bottom: 4px;
        }
        .editor-label label {
            margin-top: 0;
            margin-bottom: 0;
        }
        .editor-label .hint {
            font-size: 12px;
            color: #999;
        }
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
        .resend-hint code {
            background: #f0f0f0;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

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
        .auth-box h2 {
            text-align: center;
            margin-bottom: 24px;
        }
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
        .auth-box input:focus {
            outline: none;
            border-color: #667eea;
        }
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
        .auth-box .auth-link a {
            color: #667eea;
            cursor: pointer;
            text-decoration: none;
        }
        .auth-box .auth-link a:hover { text-decoration: underline; }
        .auth-box .auth-error {
            color: #e74c3c;
            font-size: 13px;
            margin-bottom: 8px;
            display: none;
        }
        .auth-box .auth-hint {
            color: #999;
            font-size: 13px;
            text-align: center;
            margin-bottom: 12px;
        }

        /* ===== 管理员面板 ===== */
        .admin-panel {
            display: none;
            margin-top: 20px;
            padding: 16px;
            background: #f8f9fc;
            border-radius: 12px;
            border: 1px solid #e8ecf4;
        }
        .admin-panel h3 {
            font-size: 15px;
            margin-bottom: 12px;
            color: #333;
        }
        .admin-panel .field {
            margin-bottom: 10px;
        }
        .admin-panel .field label {
            font-size: 13px;
            font-weight: 600;
            display: block;
            margin-bottom: 2px;
            color: #555;
        }
        .admin-panel .field input {
            width: 100%;
            padding: 8px 12px;
            border: 2px solid #e8ecf4;
            border-radius: 6px;
            font-size: 14px;
            font-family: inherit;
            transition: border-color 0.15s;
        }
        .admin-panel .field input:focus {
            outline: none;
            border-color: #667eea;
        }
        .admin-panel .field .code-row {
            display: flex;
            gap: 8px;
        }
        .admin-panel .field .code-row input {
            flex: 1;
        }
        .admin-panel .field .code-row button {
            padding: 8px 16px;
            background: #667eea;
            color: white;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            white-space: nowrap;
        }
        .admin-panel .field .code-row button:hover { background: #5a6fd6; }
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
    </style>
</head>
<body>

<!-- ===== 登录页面 ===== -->
<div id="loginPage" class="auth-page">
    <div class="auth-box">
        <h2>登录</h2>
        <div id="loginError" class="auth-error"></div>
        <div id="loginHint" class="auth-hint"></div>
        <input id="loginEmail" type="email" placeholder="邮箱" />
        <input id="loginPassword" type="password" placeholder="密码" />
        <button class="auth-btn" onclick="login()">登录</button>
        <div class="auth-link">
            还没有账号？<a onclick="showRegister()">去注册</a>
        </div>
    </div>
</div>

<!-- ===== 注册页面 ===== -->
<div id="registerPage" class="auth-page" style="display:none;">
    <div class="auth-box">
        <h2>注册</h2>
        <div id="regError" class="auth-error"></div>
        <input id="regEmail" type="email" placeholder="邮箱" />
        <input id="regPassword" type="password" placeholder="密码" />
        <input id="regCode" placeholder="注册码" style="text-transform:uppercase;" />
        <button class="auth-btn" onclick="register()">注册</button>
        <div class="auth-link">
            已有账号？<a onclick="showLogin()">去登录</a>
        </div>
    </div>
</div>

<!-- ===== 主应用（登录后显示） ===== -->
<div id="mainApp" style="display:none;">
<div class="app">
    <header>
        <h1 id="headerTitle">📧 邮件管理</h1>
        <div>
            <span class="badge" id="userBadge">👤 </span>
            <span class="badge" onclick="logout()" style="cursor:pointer;margin-left:8px;">🚪 退出</span>
        </div>
    </header>

    <div class="container">
        <div class="sidebar">
            <button class="compose-btn" onclick="openCompose()">✏️ 写新邮件</button>

            <!-- 管理员面板 -->
            <div id="adminPanel" class="admin-panel">
                <h3>⚙️ 系统设置</h3>
                <div class="field">
                    <label>页面标题</label>
                    <input id="adminTitle" />
                </div>
                <div class="field">
                    <label>发件邮箱</label>
                    <input id="adminSender" />
                </div>
                <div class="field">
                    <label>注册码</label>
                    <div class="code-row">
                        <input id="adminRegCode" readonly />
                        <button onclick="generateRegCode()">生成新码</button>
                    </div>
                </div>
                <div class="field">
                    <label>修改管理员密码</label>
                    <input id="adminNewPassword" type="password" placeholder="留空不修改" />
                </div>
                <button class="save-btn" onclick="saveAdminSettings()">保存设置</button>
            </div>

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
</div>

<!-- ===== 写邮件弹窗 ===== -->
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
        <div class="editor-label">
            <label>内容</label>
            <span class="hint">← 源码 | 预览 → (右边可直接编辑)</span>
        </div>
        <div class="editor-split">
            <div class="left">
                <textarea id="composeHtml" placeholder="写 HTML 源码..."></textarea>
            </div>
            <div class="right" id="composePreview" contenteditable="true">
                <span class="empty-hint">👈 左边写源码，或直接在右边编辑文字</span>
            </div>
        </div>
        <div class="resend-hint" id="resendHint">
            ⚠️ 未配置 Resend API Key，无法发送邮件。<br />
            请在终端运行：<code>npx wrangler secret put RESEND_API_KEY</code>
        </div>
        <button class="send-btn" id="composeSendBtn" onclick="sendCompose()">📤 发送</button>
    </div>
</div>

<!-- ===== 查看邮件弹窗 ===== -->
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

    if (!email || !password || !regCode) {
        showError('regError', '请填写完整信息');
        return;
    }
    hideError('regError');

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

    // 加载管理员账号提示
    try {
        const resp = await fetch('/admin/account');
        const data = await resp.json();
        if (data.account) {
            $('loginHint').textContent = '管理员账号：' + data.account;
        }
    } catch { /* ignore */ }

    // 加载用户信息
    await loadUserInfo();
    await loadAdminSettings();
    await loadMails();
    await checkResend();
    refreshInterval = setInterval(loadMails, 30000);
}

// ============================================================
// 加载用户信息
// ============================================================
async function loadUserInfo() {
    try {
        const resp = await fetch('/user/info');
        const data = await resp.json();
        if (data.success) {
            $('userBadge').textContent = '👤 ' + data.email + (data.role === 'admin' ? ' (管理员)' : '');
            if (data.role === 'admin') {
                $('adminPanel').style.display = 'block';
            }
        }
    } catch { /* ignore */ }
}

// ============================================================
// 加载管理员设置
// ============================================================
async function loadAdminSettings() {
    try {
        const resp = await fetch('/admin/settings');
        const data = await resp.json();
        if (data.success) {
            $('adminTitle').value = data.title || '';
            $('adminSender').value = data.sender || '';
            $('adminRegCode').value = data.regCode || '暂无注册码';
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
    const sender = $('adminSender').value.trim();
    const newPassword = $('adminNewPassword').value.trim();

    const payload = { title, sender };
    if (newPassword) {
        payload.password_hash = await sha256(newPassword);
    }

    try {
        const resp = await fetch('/admin/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (!data.success) {
            showToast('保存失败: ' + data.error, true);
            return;
        }
        showToast('✅ 设置已保存');
        $('adminNewPassword').value = '';
        await loadAdminSettings();
    } catch (e) {
        showToast('网络错误', true);
    }
}

// ============================================================
// 生成注册码
// ============================================================
async function generateRegCode() {
    try {
        const resp = await fetch('/admin/regcode', { method: 'POST' });
        const data = await resp.json();
        if (!data.success) {
            showToast('生成失败: ' + data.error, true);
            return;
        }
        $('adminRegCode').value = data.regCode;
        showToast('✅ 新注册码已生成');
    } catch (e) {
        showToast('网络错误', true);
    }
}

// ============================================================
// 检查 Resend
// ============================================================
let resendConfigured = false;

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
let refreshInterval = null;
const mailListEl = $('mailList');

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
        <div class="mail-item" onclick="viewMail('\${m.id}')">
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
// 查看邮件
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
    checkResend().then(() => {
        if (!resendConfigured) {
            showToast('⚠️ 请先配置 Resend API Key', true);
            return;
        }
        const mail = mails.find(m => m.id === currentViewId);
        if (!mail) return;
        closeView();
        $('composeTo').value = mail.from;
        $('composeSubject').value = 'Re: ' + (mail.subject || '');
        const replyContent = '<br><br>--- 原始邮件 ---<br>' + (mail.text || '').replace(/\\n/g, '<br>');
        $('composeHtml').value = replyContent;
        const preview = $('composePreview');
        preview.innerHTML = replyContent;
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
    } catch (e) {
        showToast('删除失败: ' + e.message, true);
    }
}

// ============================================================
// 写邮件
// ============================================================
function openCompose() {
    checkResend();
    $('composeTo').value = '';
    $('composeSubject').value = '';
    $('composeHtml').value = '';
    const preview = $('composePreview');
    preview.innerHTML = '👈 左边写源码，或直接在右边编辑文字';
    $('composeModal').classList.add('active');
}

function closeCompose() {
    $('composeModal').classList.remove('active');
}

async function sendCompose() {
    const to = $('composeTo').value.trim();
    const subject = $('composeSubject').value.trim();

    if (!resendConfigured) {
        showToast('⚠️ 请先配置 Resend API Key', true);
        return;
    }

    const preview = $('composePreview');
    const previewContent = preview.innerHTML;
    const placeholder = '👈 左边写源码，或直接在右边编辑文字';
    if (previewContent && previewContent.trim() !== placeholder) {
        $('composeHtml').value = previewContent;
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

// ============================================================
// 初始化
// ============================================================
// 检查是否已登录
async function init() {
    const sessionId = document.cookie.match(/session=([^;]+)/)?.[1];
    if (sessionId) {
        try {
            const resp = await fetch('/user/info');
            if (resp.ok) {
                loadMainApp();
                return;
            }
        } catch { /* ignore */ }
    }
    $('loginPage').style.display = 'flex';
    $('registerPage').style.display = 'none';
    // 加载管理员账号提示
    try {
        const resp = await fetch('/admin/account');
        const data = await resp.json();
        if (data.account) {
            $('loginHint').textContent = '管理员账号：' + data.account;
        }
    } catch { /* ignore */ }
}

// 页面加载时执行
document.addEventListener('DOMContentLoaded', init);

// 键盘事件：回车登录/注册
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        if ($('loginPage').style.display !== 'none') {
            login();
        } else if ($('registerPage').style.display !== 'none') {
            register();
        }
    }
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

            // ===== 邮件内容存 EMAIL KV =====
            await env.EMAIL.put(messageId, JSON.stringify(emailData), {
                expirationTtl: 30 * 24 * 60 * 60,
            });

            // ===== 全局邮件索引存 EMAIL KV =====
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

            // ===== 用户邮件列表存 EMAIL_USER KV =====
            // 收件人可能有多个
            const recipients = parsed.to.split(',').map(r => r.trim());
            for (const recipient of recipients) {
                const userListKey = `user:${recipient}:list`;
                const userIdsJson = await env.EMAIL_USER.get(userListKey);
                let userIds: string[] = userIdsJson ? JSON.parse(userIdsJson) : [];
                userIds.push(messageId);
                if (userIds.length > 500) {
                    userIds = userIds.slice(-500);
                }
                await env.EMAIL_USER.put(userListKey, JSON.stringify(userIds));
            }

            // ===== 自动回复（需要 Resend Key）=====
            if (env.RESEND_API_KEY) {
                await sendAutoReply(
                    env.RESEND_API_KEY,
                    env.DOMAIN,
                    parsed.from,
                    parsed.subject
                );
                const updated = { ...emailData, status: 'replied' as const };
                await env.EMAIL.put(messageId, JSON.stringify(updated));
                console.log(`✅ 邮件已存储并自动回复`);
            } else {
                console.log(`✅ 邮件已存储（未配置 Resend，跳过自动回复）`);
            }
        } catch (error) {
            console.error('❌ 处理邮件失败:', error);
        }
    },

    async fetch(request: Request, env: Env, ctx: ExecutionContext) {
        const url = new URL(request.url);
        const path = url.pathname;

        // ============================================================
        // 获取 Session
        // ============================================================
        async function getSessionFromCookie() {
            const cookie = request.headers.get('Cookie') || '';
            const sessionId = cookie.match(/session=([^;]+)/)?.[1];
            if (!sessionId) return null;
            return await getSession(env, sessionId);
        }

        // ============================================================
        // 检查登录状态
        // ============================================================
        if (path === '/user/info') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ success: false, error: '未登录' }, { status: 401 });
            }
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

                // 验证注册码
                const regCodeHash = await sha256(regCode);
                if (!(await verifyRegCode(env, regCodeHash))) {
                    return Response.json({ success: false, error: '注册码错误' }, { status: 400 });
                }

                // 检查用户是否已存在
                if (await userExists(env, email)) {
                    return Response.json({ success: false, error: '该邮箱已注册' }, { status: 400 });
                }

                // 判断是否为第一个用户（自动成为管理员）
                const hasAdminUser = await hasAdmin(env);
                const role = hasAdminUser ? 'user' : 'admin';

                // 创建用户
                await createUser(env, email, password_hash, role);

                // 如果是第一个用户（管理员），标记管理员已存在
                if (!hasAdminUser) {
                    await setAdminExists(env, true);
                    // 生成默认注册码
                    await generateRegCode(env);
                    // 同时把管理员账号名同步到普通变量（可选）
                    // 但普通变量需要重新部署才能生效，所以建议在控制台手动设置
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

                // 从 EMAIL_USER KV 获取用户信息
                const user = await getUser(env, email);
                if (!user) {
                    return Response.json({ success: false, error: '用户不存在' }, { status: 400 });
                }

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
            if (sessionId) {
                await destroySession(env, sessionId);
            }
            return Response.json({ success: true });
        }

        // ============================================================
        // 获取管理员设置（需要登录 + 管理员权限）
        // ============================================================
        if (path === '/admin/settings' && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ success: false, error: '未登录' }, { status: 401 });
            }
            if (session.role !== 'admin') {
                return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });
            }

            const settings = await getAdminSettings(env);
            // 获取当前注册码明文（如果有）
            let regCode = '暂无注册码';
            const regCodeHash = await env.EMAIL_USER.get('admin:regcode_hash');
            // 注册码无法反推，只显示"已设置"
            if (regCodeHash) {
                regCode = '已设置（点击生成新码）';
            }
            return Response.json({ success: true, ...settings, regCode });
        }

        // ============================================================
        // 保存管理员设置（需要登录 + 管理员权限）
        // ============================================================
        if (path === '/admin/settings' && request.method === 'POST') {
            try {
                const session = await getSessionFromCookie();
                if (!session) {
                    return Response.json({ success: false, error: '未登录' }, { status: 401 });
                }
                if (session.role !== 'admin') {
                    return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });
                }

                const body = await request.json() as { title: string; sender: string; password_hash?: string };
                await saveAdminSettings(env, body.title, body.sender);

                if (body.password_hash) {
                    await setAdminPasswordHash(env, body.password_hash);
                }

                return Response.json({ success: true });
            } catch (error) {
                return Response.json({ success: false, error: String(error) }, { status: 500 });
            }
        }

        // ============================================================
        // 生成注册码（需要登录 + 管理员权限）
        // ============================================================
        if (path === '/admin/regcode' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ success: false, error: '未登录' }, { status: 401 });
            }
            if (session.role !== 'admin') {
                return Response.json({ success: false, error: '需要管理员权限' }, { status: 403 });
            }

            const code = await generateRegCode(env);
            return Response.json({ success: true, regCode: code });
        }

        // ============================================================
        // 检查 Resend
        // ============================================================
        if (path === '/check-resend') {
            const hasKey = !!env.RESEND_API_KEY;
            return Response.json({ configured: hasKey });
        }

        // ============================================================
        // 获取邮件列表（根据角色过滤）
        // ============================================================
        if (path === '/mails' && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            let ids: string[] = [];
            if (session.role === 'admin') {
                // 管理员看全部邮件
                const idsJson = await env.EMAIL.get('_mail_ids');
                ids = idsJson ? JSON.parse(idsJson) : [];
            } else {
                // 普通用户只看自己的邮件
                const userListKey = `user:${session.email}:list`;
                const idsJson = await env.EMAIL_USER.get(userListKey);
                ids = idsJson ? JSON.parse(idsJson) : [];
            }

            const recentIds = ids.slice(-50).reverse();
            const mails: StoredEmail[] = [];
            for (const id of recentIds) {
                const data = await env.EMAIL.get(id);
                if (data) {
                    try {
                        mails.push(JSON.parse(data));
                    } catch { /* ignore */ }
                }
            }
            return Response.json({ mails });
        }

        // ============================================================
        // 获取单封邮件（检查权限：用户只能看自己的邮件，管理员看全部）
        // ============================================================
        if (path.startsWith('/mail/') && request.method === 'GET') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            const id = decodeURIComponent(path.split('/')[2]);
            if (!id) {
                return Response.json({ error: '缺少邮件 ID' }, { status: 400 });
            }

            const data = await env.EMAIL.get(id);
            if (!data) {
                return Response.json({ error: '邮件不存在' }, { status: 404 });
            }

            const mail = JSON.parse(data) as StoredEmail;

            // 普通用户检查权限：只能看自己的邮件（发件人或收件人匹配）
            if (session.role !== 'admin') {
                const userEmail = session.email;
                const from = mail.from?.toLowerCase() || '';
                const to = mail.to?.toLowerCase() || '';
                if (from !== userEmail && to !== userEmail) {
                    return Response.json({ error: '无权查看此邮件' }, { status: 403 });
                }
            }

            return Response.json(mail);
        }

        // ============================================================
        // 删除邮件（检查权限）
        // ============================================================
        if (path.startsWith('/mail/') && request.method === 'DELETE') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            const id = decodeURIComponent(path.split('/')[2]);
            if (!id) {
                return Response.json({ error: '缺少邮件 ID' }, { status: 400 });
            }

            // 检查邮件是否存在
            const data = await env.EMAIL.get(id);
            if (!data) {
                return Response.json({ error: '邮件不存在' }, { status: 404 });
            }

            const mail = JSON.parse(data) as StoredEmail;

            // 普通用户检查权限：只能删除自己的邮件
            if (session.role !== 'admin') {
                const userEmail = session.email;
                const to = mail.to?.toLowerCase() || '';
                if (to !== userEmail) {
                    return Response.json({ error: '无权删除此邮件' }, { status: 403 });
                }
            }

            // 从全局索引删除
            const idsJson = await env.EMAIL.get('_mail_ids');
            let ids: string[] = idsJson ? JSON.parse(idsJson) : [];
            ids = ids.filter((i) => i !== id);
            await env.EMAIL.put('_mail_ids', JSON.stringify(ids));

            // 从用户邮件列表删除
            if (session.role === 'admin') {
                // 管理员删除时，从所有用户列表中移除
                // 简化处理：遍历所有用户（生产环境建议用 D1）
                // 这里只从全局索引删除，用户列表中的记录保留但不会显示
            } else {
                const userListKey = `user:${session.email}:list`;
                const userIdsJson = await env.EMAIL_USER.get(userListKey);
                let userIds: string[] = userIdsJson ? JSON.parse(userIdsJson) : [];
                userIds = userIds.filter((i) => i !== id);
                await env.EMAIL_USER.put(userListKey, JSON.stringify(userIds));
            }

            // 删除邮件内容（管理员删除时会真正删除，普通用户删除只是从列表移除）
            // 考虑到共享邮件，只有在没有用户引用时再删除
            // 简化处理：管理员删除时直接删除邮件内容
            if (session.role === 'admin') {
                await env.EMAIL.delete(id);
            }

            return Response.json({ success: true });
        }

        // ============================================================
        // 发送邮件
        // ============================================================
        if (path === '/send' && request.method === 'POST') {
            const session = await getSessionFromCookie();
            if (!session) {
                return Response.json({ error: '未登录' }, { status: 401 });
            }

            if (!env.RESEND_API_KEY) {
                return Response.json(
                    { success: false, error: 'Resend API Key 未配置' },
                    { status: 400 }
                );
            }

            try {
                const body = (await request.json()) as {
                    to: string | string[];
                    subject: string;
                    html: string;
                    text?: string;
                };

                // 获取发件人邮箱（管理员设置或默认）
                const sender = await env.EMAIL_USER.get('admin:sender') || `noreply@${env.DOMAIN}`;

                const result = await sendEmail(
                    env.RESEND_API_KEY,
                    sender,
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
