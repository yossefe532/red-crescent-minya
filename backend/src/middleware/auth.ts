import { Context, Next } from 'hono';
import { Env, AppEnv } from '../env';

const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export async function createSession(adminId: string, username: string, env: Env): Promise<string> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();

  await env.DB.prepare(`
    INSERT INTO admin_sessions (token, admin_id, username, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(token, adminId, username, expiresAt).run();

  return token;
}

export async function destroySession(token: string, env: Env): Promise<void> {
  await env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
}

export async function getSession(token: string, env: Env): Promise<{ adminId: string; username: string } | null> {
  const result = await env.DB.prepare(`
    SELECT admin_id, username, expires_at FROM admin_sessions
    WHERE token = ?
  `).bind(token).first();

  if (!result) return null;
  
  const expiresAt = (result as any).expires_at;
  const expiry = new Date(expiresAt).getTime();
  
  if (Date.now() > expiry) {
    await destroySession(token, env);
    return null;
  }
  
  return { adminId: (result as any).admin_id, username: (result as any).username };
}

export async function adminAuth(c: Context<AppEnv>, next: Next) {
  // Support both Cookie (rc_session) and X-Auth-Token header
  let token: string | null = null;

  // 1. Try X-Auth-Token header first (for API calls)
  const authHeader = c.req.header('X-Auth-Token');
  if (authHeader) {
    token = authHeader.trim();
  } else {
    // 2. Fall back to Cookie (for browser requests)
    const cookie = c.req.header('cookie');
    if (cookie) {
      const match = cookie.match(/rc_session=([^;]+)/);
      if (match) {
        token = match[1].trim();
      }
    }
  }

  if (!token) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }

  const session = await getSession(token, c.env);
  if (!session) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }, 401);
  }

  c.set('adminId', session.adminId);
  c.set('adminUsername', session.username);
  await next();
}

export function getAdminId(c: Context<AppEnv>): string {
  return c.get('adminId');
}
