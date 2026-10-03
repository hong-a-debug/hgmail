// src/attachment.ts
import { Env } from './types';

export interface Attachment {
    filename: string;
    content_type: string;
    size: number;
    url: string;
    key: string;
    content_id?: string;
}

export async function saveAttachments(
    env: Env,
    attachments: any[],
    messageId: string
): Promise<Attachment[]> {
    if (!attachments || attachments.length === 0) {
        return [];
    }

    const saved: Attachment[] = [];

    for (let i = 0; i < attachments.length; i++) {
        const att = attachments[i];
        try {
            // 扩展名只保留字母数字，避免把奇怪字符带进 R2 key
            const rawExt = att.filename?.split('.').pop() || 'bin';
            const ext = rawExt.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12) || 'bin';
            const key = `${messageId}/${i}_${Date.now()}.${ext}`;

            const content = att.content;
            // 解析器输出的字段名是 mimeType；这里以前只读 contentType，
            // 结果所有附件的类型都被写成 application/octet-stream。
            const contentType = att.mimeType || att.contentType || 'application/octet-stream';

            await env.ATTACHMENTS.put(key, content, {
                httpMetadata: {
                    contentType: contentType,
                    contentDisposition: `attachment; filename="${encodeURIComponent(att.filename || 'attachment')}"`
                }
            });

            let size = 0;
            if (att.content instanceof ArrayBuffer) {
                size = att.content.byteLength;
            } else if (att.content instanceof Uint8Array) {
                size = att.content.length;
            } else if (att.content) {
                size = Math.ceil(att.content.length * 3 / 4);
            }

            saved.push({
                filename: att.filename || `attachment_${i}`,
                content_type: contentType,
                size: size,
                url: `/attachments/${key}`,
                key: key,
                content_id: typeof att.contentId === 'string'
                    ? att.contentId.replace(/^<|>$/g, '')
                    : undefined
            });

            console.log(`📎 附件已保存: ${att.filename} (${(size / 1024).toFixed(1)} KB)`);
        } catch (error) {
            console.error(`❌ 保存附件失败: ${att.filename}`, error);
        }
    }

    return saved;
}

export async function getAttachment(
    env: Env,
    key: string
): Promise<{ content: ArrayBuffer; contentType: string; filename: string } | null> {
    try {
        const object = await env.ATTACHMENTS.get(key);
        if (!object) return null;

        const content = await object.arrayBuffer();
        const contentType = object.httpMetadata?.contentType || 'application/octet-stream';
        const contentDisposition = object.httpMetadata?.contentDisposition || '';
        const filenameMatch = contentDisposition.match(/filename="([^"]+)"/);
        const filename = filenameMatch ? filenameMatch[1] : key.split('/').pop() || 'attachment';

        return { content, contentType, filename };
    } catch (error) {
        console.error(`❌ 获取附件失败: ${key}`, error);
        return null;
    }
}

export async function deleteAttachments(env: Env, messageId: string) {
    try {
        // R2 list 单次最多 1000 条，必须翻页，否则附件多的邮件删不干净
        let cursor: string | undefined = undefined;
        do {
            const objects = await env.ATTACHMENTS.list({ prefix: `${messageId}/`, cursor });
            for (const obj of objects.objects) {
                await env.ATTACHMENTS.delete(obj.key);
                console.log(`🗑️ 附件已删除: ${obj.key}`);
            }
            cursor = objects.truncated ? objects.cursor : undefined;
        } while (cursor);
    } catch (error) {
        console.error(`❌ 删除附件失败: ${messageId}`, error);
    }
}