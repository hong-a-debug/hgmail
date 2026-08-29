import { Env, User, Session } from './types';

export async function getUser(env: Env, email: string): Promise<User | null> {
    const data = await env.EMAIL_USER.get(`user:${email}`);
    if (!data) return null;
    return JSON.parse(data);
}

export async function createUser(
    env: Env,
    email: string,
    passwordHash: string,
    role: 'admin' | 'user' = 'user'
): Promise<User> {
    const user: User = { email, password_hash: passwordHash, role, created_at: new Date().toISOString() };
    await env.EMAIL_USER.put(`user:${email}`, JSON.stringify(user));
    return user;
}

export async function userExists(env: Env, email: string): Promise<boolean> {
    const data = await env.EMAIL_USER.get(`user:${email}`);
    return !!data;
}

export async function createSession(env: Env, email: string, role: 'admin' | 'user'): Promise<string> {
    const sessionId = crypto.randomUUID();
    const session: Session = { email, role, created_at: new Date().toISOString() };
    await env.EMAIL_USER.put(`session:${sessionId}`, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 7 });
    return sessionId;
}

export async function getSession(env: Env, sessionId: string): Promise<Session | null> {
    const data = await env.EMAIL_USER.get(`session:${sessionId}`);
    if (!data) return null;
    return JSON.parse(data);
}

export async function destroySession(env: Env, sessionId: string) {
    await env.EMAIL_USER.delete(`session:${sessionId}`);
}

export async function hasAdmin(env: Env): Promise<boolean> {
    const adminExists = await env.EMAIL_USER.get('_admin_exists');
    return adminExists === 'true';
}

export async function setAdminExists(env: Env, exists: boolean) {
    await env.EMAIL_USER.put('_admin_exists', exists ? 'true' : 'false');
}
