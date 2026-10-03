/// <reference types="@cloudflare/workers-types" />

export interface StoredEmail {
    id: string;
    from: string;
    to: string;
    /** 该邮件的全部收件人（信封 + To/Cc，已归一化去重）。旧记录没有此字段，回退用 to 判断。 */
    recipients?: string[];
    subject: string;
    timestamp: string;
    text: string;
    html?: string;
    attachments?: AttachmentInfo[];
    status: 'received' | 'replied' | 'forwarded' | 'read' | 'spam';
}

export interface AttachmentInfo {
    filename: string;
    content_type: string;
    size: number;
    url: string;
    key: string;
    /** 邮件里 cid: 引用用的 Content-ID（已去掉尖括号），用于把内嵌图片地址重写成本站地址 */
    content_id?: string;
}

/**
 * 邮件索引项。
 *
 * 索引里直接存摘要（而不是只存 id），列表、搜索、分页都只靠一次 KV 读取完成。
 * 旧版本索引里是一个个邮件 id，读取时会自动升级成这个结构。
 */
export interface MailIndexEntry {
    id: string;
    from: string;
    to: string;
    subject: string;
    timestamp: string;
    status: string;
    attachmentCount: number;
    snippet: string;
}

export interface User {
    email: string;
    password_hash: string;
    role: 'admin' | 'user';
    created_at: string;
}

export interface Session {
    email: string;
    role: 'admin' | 'user';
    created_at: string;
}

export interface Env {
    EMAIL: KVNamespace;
    EMAIL_USER: KVNamespace;
    ATTACHMENTS: R2Bucket;
    RESEND_API_KEY: string;
    DOMAIN: string;
    ADMIN_ACCOUNT: string;
    VAPID_PUBLIC_KEY: string;
    VAPID_PRIVATE_KEY: string;
}