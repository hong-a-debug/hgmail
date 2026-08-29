/// <reference types="@cloudflare/workers-types" />

export interface StoredEmail {
    id: string;
    from: string;
    to: string;
    subject: string;
    timestamp: string;
    text: string;
    html?: string;
    status: 'received' | 'replied' | 'forwarded';
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
    EMAIL: KVNamespace;          // 邮件存储
    EMAIL_USER: KVNamespace;     // 用户存储
    RESEND_API_KEY: string;
    DOMAIN: string;
    ADMIN_ACCOUNT: string;       // 普通变量
}
