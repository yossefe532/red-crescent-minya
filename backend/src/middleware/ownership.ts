/**
 * Ownership Middleware — Device/Browser Identification
 *
 * Ensures every public registration request carries an ownership_token cookie.
 * The token is a server-generated UUID stored in a Secure HttpOnly cookie.
 * It associates registrations with the device/browser that created them,
 * enabling self-cancellation without user accounts.
 */
import { Context, Next } from 'hono';

const COOKIE_NAME = 'ownership_token';
const MAX_AGE = 365 * 24 * 60 * 60; // 1 year

/**
 * Extract ownership_token from Cookie header.
 * Returns null if absent or malformed.
 */
function parseOwnershipCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  return match ? match[1].trim() : null;
}

/**
 * Hono middleware: ensures ownership_token exists on the context.
 *
 * - If the request already has an ownership_token cookie, use it.
 * - Otherwise, generate a new UUID and set it via Set-Cookie header.
 * - The token is attached to `c.var.ownership_token` for downstream handlers.
 */
export async function ownershipMiddleware(c: Context, next: Next) {
  const existing = parseOwnershipCookie(c.req.header('Cookie'));

  if (existing && existing.length > 0) {
    c.set('ownership_token', existing);
  } else {
    const newToken = crypto.randomUUID();
    c.set('ownership_token', newToken);
    c.header(
      'Set-Cookie',
      `${COOKIE_NAME}=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}`,
      { append: true },
    );
  }

  await next();
}

/**
 * Helper: read ownership_token from a Hono context (for non-middleware use).
 */
export function getOwnershipToken(c: Context): string | null {
  return c.get('ownership_token') ?? parseOwnershipCookie(c.req.header('Cookie'));
}
