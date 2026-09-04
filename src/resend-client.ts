// src/resend-client.ts
import { Resend } from 'resend';

export async function sendEmail(
    apiKey: string,
    from: string,
    to: string | string[],
    subject: string,
    html: string,
    text?: string,
    attachments?: { filename: string; content: string }[]  // ← 新增附件参数
): Promise<{ id: string }> {
    const resend = new Resend(apiKey);
    
    const { data, error } = await resend.emails.send({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''),
        attachments: attachments || [],  // ← 传给 Resend
    });

    if (error) {
        throw new Error(`Resend 发送失败: ${error.message}`);
    }
    
    if (!data?.id) {
        throw new Error('Resend 返回了无效响应');
    }
    
    return { id: data.id };
}

export async function sendAutoReply(
    apiKey: string,
    domain: string,
    to: string,
    originalSubject: string
): Promise<string> {
    const result = await sendEmail(
        apiKey,
        `noreply@${domain}`,
        to,
        `Re: ${originalSubject}`,
        `
            <div style="font-family: sans-serif; max-width: 600px;">
                <p>感谢您的来信！我们已收到您的邮件，会尽快处理。</p>
                <hr style="border: none; border-top: 1px solid #eee;" />
                <p style="color: #666; font-size: 14px;">这是一封自动回复，请勿直接回复本邮件。</p>
            </div>
        `,
        '感谢您的来信！我们已收到您的邮件，会尽快处理。'
    );
    return result.id;
}
