const style = "color: red; font-size: 60px; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);";
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
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .join('<br>');
}

/** 回复主题：已带 Re: 前缀不重复加 */
function replySubject(subject) {
    const s = String(subject == null ? '' : subject).trim();
    if (!s || s === '(无主题)') return 'Re: (无主题)';
    return /^re\s*:/i.test(s) ? s : 'Re: ' + s;
}

/** 转发主题：已带 Fwd:/Fw: 前缀不重复加 */
function forwardSubject(subject) {
    const s = String(subject == null ? '' : subject).trim();
    if (!s || s === '(无主题)') return 'Fwd: (无主题)';
    return /^fw?d?\s*:/i.test(s) ? s : 'Fwd: ' + s;
}

// ============================================================
// 登录/注册切换
// ============================================================
function showLogin() {
    $('loginPage').style.display = 'flex';
    $('registerPage').style.display = 'none';
    $('resetPage').style.display = 'none';
    hideError('loginError');
    hideError('regError');
}

function showRegister() {
    $('loginPage').style.display = 'none';
    $('registerPage').style.display = 'flex';
    $('resetPage').style.display = 'none';
    hideError('loginError');
    hideError('regError');
    checkHasAdmin();
}

// ============================================================
// 找回密码
// ============================================================
let resetToken = '';

function showResetRequest() {
    resetToken = '';
    $('loginPage').style.display = 'none';
    $('registerPage').style.display = 'none';
    $('resetPage').style.display = 'flex';
    hideError('resetError');
    $('resetMsg').textContent = '输入注册时用的邮箱，我们会发一封带重置链接的邮件。';
    $('resetRequestBlock').style.display = 'block';
    $('resetConfirmBlock').style.display = 'none';
}

/** 带 ?reset=<token> 打开时直接进入设置新密码的界面 */
function showResetConfirm(token) {
    resetToken = token;
    $('loginPage').style.display = 'none';
    $('registerPage').style.display = 'none';
    $('resetPage').style.display = 'flex';
    hideError('resetError');
    $('resetMsg').textContent = '请设置新密码。';
    $('resetRequestBlock').style.display = 'none';
    $('resetConfirmBlock').style.display = 'block';
}

async function requestReset() {
    const email = $('resetEmail').value.trim();
    if (!email) { showError('resetError', '请输入邮箱'); return; }
    hideError('resetError');
    try {
        const resp = await fetch('/password/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await resp.json();
        if (!data.success) { showError('resetError', data.error || '请求失败'); return; }
        // 服务端对「账号存在与否」返回同样的结果，这里也不做区分
        $('resetMsg').textContent = '如果这个邮箱已注册，重置链接已经发出，请查收（30 分钟内有效）。';
    } catch (e) { showError('resetError', '网络错误，请重试'); }
}

async function submitReset() {
    const password = $('resetNewPassword').value;
    const confirm = $('resetConfirmPassword').value;
    if (password.length < 6) { showError('resetError', '密码至少 6 位'); return; }
    if (password !== confirm) { showError('resetError', '两次输入的新密码不一致'); return; }
    hideError('resetError');
    try {
        const resp = await fetch('/password/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: resetToken, password })
        });
        const data = await resp.json();
        if (!data.success) { showError('resetError', data.error || '重置失败'); return; }
        showToast('✅ 密码已重置，请用新密码登录');
        resetToken = '';
        $('resetNewPassword').value = '';
        $('resetConfirmPassword').value = '';
        showLogin();
    } catch (e) { showError('resetError', '网络错误，请重试'); }
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
        showToast(data.needsConfirm ? '✅ 注册成功，请到邮箱点确认链接后再登录' : '✅ 注册成功！请登录');
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
                        if (adminData.settings.sendExternal !== undefined) {
                            document.querySelector('input[name="sendExternal"][value="' + (adminData.settings.sendExternal ? 'on' : 'off') + '"]').checked = true;
                        }
                        if (adminData.settings.requireConfirm !== undefined) {
                            document.querySelector('input[name="requireConfirm"][value="' + (adminData.settings.requireConfirm ? 'on' : 'off') + '"]').checked = true;
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
    const sendExternal = document.querySelector('input[name="sendExternal"]:checked').value === 'on';
    const requireConfirm = document.querySelector('input[name="requireConfirm"]:checked').value === 'on';

    // 改密码不在这里：走独立的「修改密码」弹窗（/user/password）
    const payload = { title, senderPrefix, autoReply, sendExternal, requireConfirm };

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
    loadSessions();
}

function closePasswordModal() {
    $('passwordModal').classList.remove('active');
}

// ============================================================
// 登录设备（查看并踢出其他设备）
// ============================================================
async function loadSessions() {
    const box = $('sessionList');
    if (!box) return;
    box.textContent = '加载中…';
    try {
        const resp = await fetch('/user/sessions');
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            box.textContent = '加载失败：' + (data.error || resp.status);
            return;
        }
        renderSessions(data.sessions || []);
    } catch (e) { box.textContent = '网络错误'; }
}

function renderSessions(list) {
    const box = $('sessionList');
    if (!list.length) { box.textContent = '没有其它登录设备'; return; }
    box.innerHTML = list.map(function (s) {
        const when = s.created_at ? formatTime(s.created_at) : '时间未知';
        const tail = s.current
            ? '<span style="color:#27ae60;font-size:12px;">当前设备</span>'
            : '<button class="page-btn" data-action="revokeSession" data-arg="' + escapeHtml(s.id) + '">退出该设备</button>';
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;">'
            + '<span style="flex:1;">' + escapeHtml(when) + '</span>' + tail + '</div>';
    }).join('');
}

async function revokeSession(hash) {
    if (!hash) return;
    if (!confirm('确定要让这个设备退出登录吗？')) return;
    try {
        const resp = await fetch('/user/sessions/revoke', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: hash })
        });
        const data = await resp.json();
        if (!data.success) { showToast('操作失败：' + (data.error || ''), true); return; }
        showToast(data.removed ? '✅ 该设备已退出' : '没找到这个设备');
        loadSessions();
    } catch (e) { showToast('网络错误', true); }
}

// ============================================================
// 垃圾邮件隔离区（管理员）
// ============================================================
function openSpamModal() {
    $('spamModal').classList.add('active');
    loadSpam();
}

function closeSpamModal() {
    $('spamModal').classList.remove('active');
}

async function loadSpam() {
    const box = $('spamList');
    if (!box) return;
    box.textContent = '加载中…';
    try {
        const resp = await fetch('/admin/spam');
        const data = await resp.json();
        if (!resp.ok || !data.success) {
            box.textContent = '加载失败：' + (data.error || resp.status);
            return;
        }
        const list = data.mails || [];
        if (!list.length) { box.textContent = '隔离区是空的'; return; }
        box.innerHTML = list.map(function (m) {
            return '<div style="padding:8px 0;border-bottom:1px solid #f0f0f0;">'
                + '<div style="font-size:13px;font-weight:600;">' + escapeHtml(m.subject || '(无主题)') + '</div>'
                + '<div style="font-size:12px;color:#999;margin-top:2px;">'
                + escapeHtml(m.from || '') + ' · ' + escapeHtml(formatTime(m.timestamp)) + '</div>'
                + (m.snippet ? '<div style="font-size:12px;color:#9aa3b2;margin-top:2px;">' + escapeHtml(m.snippet) + '</div>' : '')
                + '<button class="page-btn" style="margin-top:6px;" data-action="deleteSpam" data-arg="' + escapeHtml(m.id) + '">删除</button>'
                + '</div>';
        }).join('');
    } catch (e) { box.textContent = '网络错误'; }
}

async function deleteSpam(id) {
    if (!id) return;
    if (!confirm('确定删除这封隔离邮件吗？')) return;
    try {
        const resp = await fetch('/admin/spam/' + encodeURIComponent(id), { method: 'DELETE' });
        if (!resp.ok) throw new Error('删除失败');
        showToast('已删除');
        loadSpam();
    } catch (e) { showToast('删除失败', true); }
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
let mailPage = 1;
let mailPageSize = 20;
let mailPageCount = 1;
let mailQuery = '';
let currentViewId = null;
const mailListEl = $('mailList');

async function loadMails() {
    try {
        const params = new URLSearchParams({
            page: String(mailPage),
            pageSize: String(mailPageSize),
        });
        if (mailQuery) params.set('q', mailQuery);

        const resp = await fetch('/mails?' + params.toString());
        if (!resp.ok) throw new Error('加载失败');
        const data = await resp.json();
        // 服务端返回的是摘要（正文按需从 /mail/:id 取）
        mails = data.mails || [];
        mailTotal = typeof data.total === 'number' ? data.total : mails.length;
        mailPage = typeof data.page === 'number' ? data.page : 1;
        mailPageCount = typeof data.pageCount === 'number' ? data.pageCount : 1;
        renderMails();
        updateStats();
        updatePager();
    } catch (e) { showToast('加载邮件失败: ' + e.message, true); }
}

function renderMails() {
    if (mails.length === 0) {
        mailListEl.innerHTML = '<div class="empty-state"><div class="icon">📭</div><p>'
            + (mailQuery ? '没有匹配「' + escapeHtml(mailQuery) + '」的邮件' : '收件箱空空如也')
            + '</p></div>';
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
        if (m.snippet) html += '    <div class="snippet">' + escapeHtml(m.snippet) + '</div>';
        html += '    <div class="time">' + time + '</div>';
        html += '  </div>';
        html += '  <span class="status-badge ' + badge + '">' + badgeText + '</span>';
        html += '</div>';
    }
    mailListEl.innerHTML = html;
}

function updateStats() {
    // 总数是服务端按当前搜索条件统计的结果，不是"当前页这几封"
    $('totalCount').textContent = mailTotal;
    $('repliedCount').textContent = mails.filter(m => m.status === 'replied').length;
}

function updatePager() {
    const info = $('pageInfo');
    if (info) {
        info.textContent = mailPageCount > 0
            ? `第 ${mailPage} / ${mailPageCount} 页`
            : '';
    }
    const prev = document.querySelector('[data-action="prevPage"]');
    const next = document.querySelector('[data-action="nextPage"]');
    if (prev) prev.disabled = mailPage <= 1;
    if (next) next.disabled = mailPage >= mailPageCount;
}

function runSearch() {
    const input = $('mailSearch');
    mailQuery = input ? input.value.trim() : '';
    mailPage = 1;
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = setInterval(loadMails, 30000); }
    loadMails();
}

function clearSearch() {
    const input = $('mailSearch');
    if (input) input.value = '';
    mailQuery = '';
    mailPage = 1;
    loadMails();
}

function prevPage() {
    if (mailPage <= 1) return;
    mailPage -= 1;
    loadMails();
}

function nextPage() {
    if (mailPage >= mailPageCount) return;
    mailPage += 1;
    loadMails();
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
                // 历史邮件的附件可能没有 size 字段，直接除会显示 NaN
                var sizeText = typeof att.size === 'number' && isFinite(att.size)
                    ? (att.size / 1024).toFixed(1) + ' KB'
                    : '大小未知';
                attHtml += '  <span style="font-size:11px;color:#999;">(' + sizeText + ')</span>';
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

/** 回复或转发时打开写信弹窗。mode 为 'reply' 或 'forward' */
async function openComposeFromMail(mode) {
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

    const sourceId = currentViewId;
    closeView();

    // 转发要自己填收件人，回复则直接填原发件人
    $('composeTo').value = mode === 'reply' ? (mail.from || '') : '';
    $('composeSubject').value = mode === 'reply'
        ? replySubject(mail.subject)
        : forwardSubject(mail.subject);

    // 邮件正文一律先转义再插入：以前直接拼 innerHTML，
    // 发件人只要在纯文本正文里写 <img onerror=...> 就能在点「回复」时执行脚本。
    const header = mode === 'reply' ? '--- 原始邮件 ---' : '--- 转发的邮件 ---';
    const quoted = '<br><br>' + header + '<br>'
        + '发件人：' + textToHtml(mail.from || '') + '<br>'
        + '时间：' + textToHtml(formatTime(mail.timestamp)) + '<br><br>'
        + textToHtml(mail.text || '');
    $('composeHtml').value = quoted;
    $('composePreview').innerHTML = quoted;

    // 记住来源，发送成功后回写状态（回复 → replied，转发 → forwarded）
    composeContext = { id: sourceId, mode };
    $('composeModal').classList.add('active');
}

function replyFromView() { return openComposeFromMail('reply'); }
function forwardFromView() { return openComposeFromMail('forward'); }

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
    composeContext = null;   // 新写的邮件没有来源，发送后不需要回写状态
    renderAttachmentList();
    document.getElementById('composeAttachment').value = '';
    $('composeModal').classList.add('active');
}

function closeCompose() { $('composeModal').classList.remove('active'); }

// ============================================================
// 附件相关
// ============================================================
let attachments = [];
// 当前这封正在写的邮件是从哪来的（回复/转发时记录，发送成功后回写状态）
let composeContext = null;

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

        // 如果是回复/转发，把原邮件标记成对应状态（失败不影响已发送的结果）
        if (composeContext) {
            const target = composeContext.mode === 'forward' ? 'forwarded' : 'replied';
            const sourceId = composeContext.id;
            composeContext = null;
            try {
                await fetch('/mail/' + encodeURIComponent(sourceId) + '/status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: target })
                });
            } catch (e) { /* ignore */ }
        } else {
            composeContext = null;
        }

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
    const resetTokenFromUrl = urlParams.get('reset');

    // 从邮件里的重置链接进来：无论有没有登录，都直接进设置新密码的界面
    if (resetTokenFromUrl) {
        showResetConfirm(resetTokenFromUrl);
        return;
    }

    // 从邮件里的确认链接进来：调接口确认邮箱，然后回到登录页
    const confirmToken = urlParams.get('confirm');
    if (confirmToken) {
        try {
            const resp = await fetch('/register/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: confirmToken })
            });
            const data = await resp.json();
            showToast(data.success ? '✅ 邮箱已确认，请登录' : ('确认失败：' + (data.error || '')), !data.success);
        } catch (e) {
            showToast('确认失败：网络错误', true);
        }
        showLogin();
        return;
    }

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
    // 搜索框回车即搜索（页面级的 Enter 处理只管登录/注册页，不会冲突）
    const search = $('mailSearch');
    if (search) {
        search.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
        });
    }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        const loginPage = $('loginPage');
        const registerPage = $('registerPage');
        const resetPage = $('resetPage');
        if (loginPage && loginPage.style.display !== 'none') login();
        else if (registerPage && registerPage.style.display !== 'none') register();
        else if (resetPage && resetPage.style.display !== 'none') {
            if ($('resetConfirmBlock').style.display !== 'none') submitReset();
            else requestReset();
        }
    }
});