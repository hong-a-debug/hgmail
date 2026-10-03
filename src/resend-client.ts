// src/resend-client.ts
import { Resend } from 'resend';

export async function sendEmail(
    apiKey: string,
    from: string,
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
    attachments?: { filename: string; content: string }[],
    headers?: Record<string, string>
): Promise<{ id: string }> {
    const resend = new Resend(apiKey);

    const payload: Record<string, unknown> = {
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        attachments: attachments || [],
    };

    // 空字段不要传给 Resend：只发纯文本时，一个空的 html 会被直接拒收
    if (html && html.trim()) payload.html = html;
    const plainText = (text || '').trim()
        || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (plainText) payload.text = plainText;

    if (headers && Object.keys(headers).length > 0) payload.headers = headers;

    const { data, error } = await resend.emails.send(payload as never);

    if (error) {
        throw new Error(`Resend 发送失败: ${error.message}`);
    }

    if (!data?.id) {
        throw new Error('Resend 返回了无效响应');
    }

    return { id: data.id };
}

/** 生成回复主题，已带 Re: 前缀就不重复加 */
export function replySubject(subject: string): string {
    const s = (subject || '').trim();
    if (!s || s === '(无主题)') return 'Re: (无主题)';
    return /^re\s*:/i.test(s) ? s : `Re: ${s}`;
}

/**
 * 发送自动回复。
 * 注意第 2 个参数是**完整发件地址**（如 noreply@example.com），
 * 以前这里收的是"域名"并在内部再拼一次 noreply@，调用方传的却已经是完整地址，
 * 结果拼成 noreply@noreply@example.com，Resend 必然拒收。
 */
export async function sendAutoReply(
    apiKey: string,
    from: string,
    to: string,
    originalSubject: string,
    inReplyTo?: string
): Promise<string> {
    // 带上原邮件的 Message-ID，收件人的邮件客户端才能把它归到同一个会话里，
    // 否则自动回复在对方那边永远是一条孤立的新邮件。
    const headers: Record<string, string> = {};
    const ref = (inReplyTo || '').trim();
    if (ref) {
        headers['In-Reply-To'] = ref;
        headers['References'] = ref;
    }

    const result = await sendEmail(
        apiKey,
        from,
        to,
        replySubject(originalSubject),
        `
            <div style="font-family: sans-serif; max-width: 600px;">
                <p>感谢您的来信！我们已收到您的邮件，会尽快处理。</p>
                <hr style="border: none; border-top: 1px solid #eee;" />
                <p style="color: #666; font-size: 14px;">这是一封自动回复，请勿直接回复本邮件。</p>
            </div>
        `,
        '感谢您的来信！我们已收到您的邮件，会尽快处理。',
        [],
        headers
    );
    return result.id;
}