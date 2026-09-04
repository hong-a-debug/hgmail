// src/email-parser.ts
import PostalMime from 'postal-mime';

// ============================================================
// ✅ 正常邮件白名单关键词（中英文）
// ============================================================
const SAFE_KEYWORDS = [
    '验证码', '激活', '注册', '登录', '密码重置', '找回密码',
    '邮箱验证', '账户验证', '安全验证', '确认邮箱',
    'verification', 'verify', 'activate', 'activation',
    'register', 'registration', 'login', 'sign in',
    'password reset', 'reset password', 'forgot password',
    'email verification', 'account verification',
    'confirm email', 'security verification',
    '2fa', 'two-factor', 'authentication',
    'welcome', '欢迎'
];

// ============================================================
// 🚫 垃圾广告关键词黑名单（中英文）
// ============================================================
const SPAM_KEYWORDS = [
    '优惠', '营销', '折扣', '促销', '特价', '秒杀', '红包',
    '免费领', '限时', '抢购', '优惠券', '代金券', '满减',
    '注册送礼', '新人福利', '返现', '积分兑换',
    '买一送一', '清仓', '甩卖', '降价', '立减',
    '赚钱', '副业', '日入', '月入',
    'discount', 'promotion', 'promo', 'sale', 'deal',
    'coupon', 'voucher', 'cashback', 'rebate',
    'free', 'freebie', 'gift', 'bonus',
    'limited time', 'flash sale', 'clearance',
    'marketing', 'advertisement', 'advert',
    'spam', 'bulk', 'mass mail',
    'earn money', 'make money', 'passive income',
    'bitcoin', 'crypto', 'forex', 'trading'
];

function isSafeMail(text: string, html?: string): boolean {
    const content = (text || '') + ' ' + (html || '');
    if (!content) return false;
    const lowerContent = content.toLowerCase();
    for (const keyword of SAFE_KEYWORDS) {
        if (lowerContent.includes(keyword.toLowerCase())) {
            return true;
        }
    }
    return false;
}

function isSpam(text: string, html?: string): boolean {
    const content = (text || '') + ' ' + (html || '');
    if (!content) return false;
    if (isSafeMail(text, html)) return false;
    const lowerContent = content.toLowerCase();
    for (const keyword of SPAM_KEYWORDS) {
        if (lowerContent.includes(keyword.toLowerCase())) {
            return true;
        }
    }
    return false;
}

function removeScriptTagsAndContent(html: string): string {
    if (!html) return html;
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function hasScriptTag(html: string): boolean {
    if (!html) return false;
    return /<script\b[^>]*>/gi.test(html);
}

export async function parseEmail(raw: ArrayBuffer): Promise<{
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments: any[];
    isSpam: boolean;
    hasScript: boolean;
}> {
    const parser = new PostalMime();
    const parsed = await parser.parse(raw);

    const from = parsed.from?.address || 'unknown';
    const to = parsed.to?.[0]?.address || 'unknown';
    const subject = parsed.subject || '(无主题)';
    const text = parsed.text || parsed.html?.replace(/<[^>]*>/g, '') || '(无内容)';
    const html = parsed.html || undefined;

    const attachments = parsed.attachments || [];

    const hasScript = html ? hasScriptTag(html) : false;
    const isSpamFlag = isSpam(text, html);

    let cleanedHtml = html;
    if (html && hasScript) {
        cleanedHtml = removeScriptTagsAndContent(html);
        console.log(`🗑️ 已删除 <script> 标签及其内容`);
    }

    return {
        from,
        to,
        subject,
        text,
        html: cleanedHtml,
        attachments,
        isSpam: isSpamFlag,
        hasScript,
    };
}
