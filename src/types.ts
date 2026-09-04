/// <reference types="@cloudflare/workers-types" />

export interface StoredEmail {
    id: string;
    from: string;
    to: string;
    subject: string;
    timestamp: string;
    text: string;
    html?: string;
    attachments?: AttachmentInfo[];
    status: 'received' | 'replied' | 'forwarded';
}

export interface AttachmentInfo {
    filename: string;
    content_type: string;
    size: number;
    url: string;
    key: string;
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
}
