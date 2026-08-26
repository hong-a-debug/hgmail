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

export interface Env {
    EMAIL: KVNamespace;
    RESEND_API_KEY: string;
    DOMAIN: string;
}