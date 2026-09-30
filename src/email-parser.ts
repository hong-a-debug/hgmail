// src/email-parser.ts
import PostalMime from 'postal-mime';

// ============================================================
// 📎 类型定义
// ============================================================
export interface ParsedAttachment {
    filename?: string;
    mimeType?: string;
    content: ArrayBuffer | Uint8Array | string;
    disposition?: string;
    contentId?: string;
    related?: boolean;
}

export interface ParsedEmailResult {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments: ParsedAttachment[];
    isSpam: boolean;
    hasScript: boolean;
}

// ============================================================
// 📐 常量
// ============================================================

// 中文字符判断正则（模块级，避免重复创建）
const CHINESE_CHAR_REGEX = /[\u4e00-\u9fa5]/;

// ============================================================
// ✅ 白名单关键词（正常邮件）
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
// 🚫 垃圾关键词 + 权重
// ============================================================
// 权重设计依据：
//   1 = 常见营销词，可能出现在正常邮件（如订单邮件里的"促销"）
//   2 = 明显促销词，正常邮件少见
//   3 = 高风险词，几乎只出现在垃圾邮件
//   4 = 极高风险词，如"赚钱""副业"
//   5 = 极端风险词，如"日入""月入"，黑产专用
// ============================================================
const SPAM_KEYWORDS: Record<string, number> = {
    // 中文
    '优惠': 1, '折扣': 1, '促销': 1, '特价': 1, '限时': 1,
    '秒杀': 2, '红包': 2, '免费领': 2, '抢购': 2,
    '优惠券': 2, '代金券': 2, '满减': 2,
    '返现': 3, '积分兑换': 3, '注册送礼': 3, '新人福利': 3,
    '买一送一': 3, '清仓': 2, '甩卖': 2, '降价': 2, '立减': 2,
    '赚钱': 4, '副业': 4, '日入': 5, '月入': 5,
    // 英文
    'discount': 1, 'promotion': 1, 'promo': 1, 'sale': 1, 'deal': 1,
    'coupon': 2, 'voucher': 2, 'cashback': 3, 'rebate': 3,
    'free': 1, 'freebie': 2, 'gift': 1, 'bonus': 1,
    'limited time': 2, 'flash sale': 3, 'clearance': 2,
    'marketing': 2, 'advertisement': 2, 'advert': 2,
    'spam': 3, 'bulk': 2, 'mass mail': 3,
    'earn money': 4, 'make money': 4, 'passive income': 4,
    'bitcoin': 3, 'crypto': 3, 'forex': 3, 'trading': 3
};

// ============================================================
// 📏 配置
// ============================================================
const SPAM_SCORE_THRESHOLD = 5;
// 中文字符信息密度高，按 2.5 个字符权重计算
const CHINESE_WEIGHT = 2.5;
const ENGLISH_WEIGHT = 1.0;
// 平滑归一化参数（越大，越不敏感）
const NORMALIZATION_SMOOTHING = 800;
// 归一化最低保留比例，避免长邮件完全不检测
const MIN_NORMALIZATION_RATIO = 0.3;
// 规范化循环的最大迭代次数（防止未预料的震荡）
const MAX_NORMALIZE_ITERATIONS = 5;

// ============================================================
// 🧹 保守的规范化
// ============================================================

/**
 * 移除零宽字符（编码层面的清理）
 */
function removeZeroWidth(text: string): string {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '');
}

/**
 * 全角转半角（编码层面的清理）
 */
function normalizeFullWidth(text: string): string {
    return text.replace(/[\uFF01-\uFF5E]/g, (ch) => {
        return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
}

/**
 * 合并分隔符（循环直到收敛）
 * 例如：f.r.e.e → free，f-r-e-e → free
 * 只处理"单字母 + 分隔符 + 字母"模式，避免误合并 hello world
 */
function normalizeSeparators(text: string): string {
    let prev: string;
    let current = text;
    do {
        prev = current;
        // 匹配"单字母 + 分隔符 + 字母"，反复替换直到不再变化
        current = current.replace(/\b([a-zA-Z])[.\-_](?=[a-zA-Z])/g, '$1');
    } while (current !== prev);
    return current;
}

// leetspeak 变体映射（单一数据源）
const LEET_VARIANTS: Record<string, string> = {
    '3': 'e',
    '0': 'o',
    '@': 'a',
    '$': 's'
    // 刻意不包含 '1': 'i'，因为 1 太常见（日期、版本号、编号）
};

// 从 LEET_VARIANTS 动态生成正则字符类（避免双写不一致）
const LEET_CHARS_CLASS = Object.keys(LEET_VARIANTS)
    .map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('');

/**
 * 处理 leetspeak 变体（只在字母串内部替换）
 *
 * 设计原则：宁可不处理，也不误伤正常文本。
 * - 处理：fr33 → free、f0o → foo、f.r.3.e → free（配合 normalizeSeparators）
 * - 不处理：mp3、Python3、3D、Windows10（正常文本，保持原样）
 * - 不处理：3free、free3（边界情况，误伤风险 > 收益）
 */
function normalizeLeetSpeak(text: string): string {
    // 只匹配"字母 + 变体(串) + 字母"，变体必须被字母包围
    const regex = new RegExp(
        `([a-zA-Z])([${LEET_CHARS_CLASS}]+)([a-zA-Z])`,
        'g'
    );
    return text.replace(regex, (_m, p1, p2, p3) => {
        let replaced = '';
        for (const ch of p2) {
            replaced += LEET_VARIANTS[ch] || ch;
        }
        return p1 + replaced + p3;
    });
}

/**
 * 综合规范化（保守策略）
 *
 * 顺序很重要：
 *   1. 移除零宽字符（编码层面的清理）
 *   2. 全角转半角（编码层面的清理）
 *   3. 合并分隔符（把 f.r.e.e → free，让变体字符暴露在字母串中）
 *   4. 处理 leetspeak（此时 f33e 可被正确处理）
 *
 * 循环执行直到收敛（处理 3 和 4 相互依赖的情况），并带迭代上限保护。
 */
function normalizeText(text: string): string {
    if (!text) return text;
    let normalized = text;
    normalized = removeZeroWidth(normalized);
    normalized = normalizeFullWidth(normalized);

    let prev: string;
    let iterations = 0;
    do {
        prev = normalized;
        normalized = normalizeSeparators(normalized);
        normalized = normalizeLeetSpeak(normalized);
        iterations++;
        if (iterations >= MAX_NORMALIZE_ITERATIONS) {
            console.warn('normalizeText 达到最大迭代次数，可能存在未收敛情况');
            break;
        }
    } while (normalized !== prev);

    return normalized;
}

// ============================================================
// 🔍 关键词匹配（DRY 原则）
// ============================================================
function buildKeywordRegex(keyword: string, flags: string): RegExp {
    if (CHINESE_CHAR_REGEX.test(keyword)) {
        return new RegExp(keyword, flags);
    }
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b', flags);
}

function matchKeyword(text: string, keyword: string): boolean {
    return buildKeywordRegex(keyword, 'i').test(text);
}

// ============================================================
// 📌 预计算白名单规范化结果（避免每次调用重复计算）
// ============================================================
const NORMALIZED_SAFE_KEYWORDS = SAFE_KEYWORDS.map((k) =>
    normalizeText(k).toLowerCase()
);

// ============================================================
// ✅ 安全邮件检测（接收已规范化的文本，参数为小写）
// ============================================================
function isSafeMailNormalized(normalizedContentLower: string): boolean {
    for (const keyword of NORMALIZED_SAFE_KEYWORDS) {
        if (matchKeyword(normalizedContentLower, keyword)) {
            return true;
        }
    }
    return false;
}

// ============================================================
// 📊 加权评分（接收已规范化的文本）
// ============================================================
function calculateSpamScore(normalizedText: string): number {
    // 一次遍历同时计算有效长度（避免第二次遍历）
    let effectiveLength = 0;
    for (const ch of normalizedText) {
        effectiveLength += CHINESE_CHAR_REGEX.test(ch)
            ? CHINESE_WEIGHT
            : ENGLISH_WEIGHT;
    }

    // 关键词加权评分
    let score = 0;
    for (const [keyword, weight] of Object.entries(SPAM_KEYWORDS)) {
        const regex = buildKeywordRegex(keyword.toLowerCase(), 'gi');
        const matches = normalizedText.match(regex);
        if (matches) {
            score += matches.length * weight;
        }
    }

    // 平滑归一化（连续函数，无跳跃点）
    const ratio = 1 / (1 + effectiveLength / NORMALIZATION_SMOOTHING);
    const finalRatio = Math.max(ratio, MIN_NORMALIZATION_RATIO);

    return score * finalRatio;
}

// ============================================================
// 🚫 垃圾邮件检测（只规范化一次）
// ============================================================
function isSpam(text: string, html?: string): boolean {
    const content = (text || '') + ' ' + (html || '');
    if (!content) return false;

    // 只规范化一次，统一转小写
    const normalized = normalizeText(content).toLowerCase();

    // 白名单优先
    if (isSafeMailNormalized(normalized)) return false;

    // 加权评分
    const score = calculateSpamScore(normalized);

    return score >= SPAM_SCORE_THRESHOLD;
}

// ============================================================
// 🧹 Script 标签清理
// ============================================================
function removeScriptTagsAndContent(html: string): string {
    if (!html) return html;
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
}

function hasScriptTag(html: string): boolean {
    if (!html) return false;
    return /<script\b[^>]*>/gi.test(html);
}

// ============================================================
// 📎 附件显式映射（跳过无效附件，避免类型欺骗）
// ============================================================
function toParsedAttachment(raw: any): ParsedAttachment | null {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.content === undefined || raw.content === null) {
        console.warn('附件缺少 content 字段，已跳过');
        return null;
    }
    return {
        filename: typeof raw.filename === 'string' ? raw.filename : undefined,
        mimeType: typeof raw.mimeType === 'string' ? raw.mimeType : undefined,
        content: raw.content,
        disposition:
            typeof raw.disposition === 'string' ? raw.disposition : undefined,
        contentId:
            typeof raw.contentId === 'string' ? raw.contentId : undefined,
        related: typeof raw.related === 'boolean' ? raw.related : undefined,
    };
}

// ============================================================
// 主解析函数
// ============================================================
export async function parseEmail(raw: ArrayBuffer): Promise<ParsedEmailResult> {
    const parser = new PostalMime();
    const parsed = await parser.parse(raw);

    const from = parsed.from?.address || 'unknown';
    const to = parsed.to?.[0]?.address || 'unknown';
    const subject = parsed.subject || '(无主题)';
    const text = parsed.text || parsed.html?.replace(/<[^>]*>/g, '') || '(无内容)';
    const html = parsed.html || undefined;

    // 显式映射附件，过滤掉无效项
    const attachments: ParsedAttachment[] = (parsed.attachments || [])
        .map(toParsedAttachment)
        .filter((a): a is ParsedAttachment => a !== null);

    const hasScript = html ? hasScriptTag(html) : false;
    // 垃圾判定用原始 html（有意为之：垃圾邮件常把关键词藏在 script 里）
    // cleanedHtml 只用于存储和展示，不影响判定
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
