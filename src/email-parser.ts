import PostalMime from 'postal-mime';

export async function parseEmail(raw: ArrayBuffer): Promise<{
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
}> {
    const parser = new PostalMime();
    const parsed = await parser.parse(raw);
    
    const from = parsed.from?.address || 'unknown';
    const to = parsed.to?.[0]?.address || 'unknown';
    const text = parsed.text || parsed.html?.replace(/<[^>]*>/g, '') || '(无内容)';
    
    return {
        from,
        to,
        subject: parsed.subject || '(无主题)',
        text: text,
        html: parsed.html || undefined,
    };
}