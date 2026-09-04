// src/attachment.ts
import { Env } from './types';

export interface Attachment {
    filename: string;
    content_type: string;
    size: number;
    url: string;
    key: string;
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
            const ext = att.filename?.split('.').pop() || 'bin';
            const key = `${messageId}/${i}_${Date.now()}.${ext}`;

            const content = att.content;
            const contentType = att.contentType || 'application/octet-stream';

            await env.ATTACHMENTS.put(key, content, {
                httpMetadata: {
                    contentType: contentType,
                    contentDisposition: `attachment; filename="${encodeURIComponent(att.filename || 'attachment')}"`
                }
            });

            saved.push({
                filename: att.filename || `attachment_${i}`,
                content_type: contentType,
                size: att.size || 0,
                url: `/attachments/${key}`,
                key: key
            });

            console.log(`📎 附件已保存: ${att.filename}`);
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
        const objects = await env.ATTACHMENTS.list({ prefix: `${messageId}/` });
        for (const obj of objects.objects) {
            await env.ATTACHMENTS.delete(obj.key);
            console.log(`🗑️ 附件已删除: ${obj.key}`);
        }
    } catch (error) {
        console.error(`❌ 删除附件失败: ${messageId}`, error);
    }
}
