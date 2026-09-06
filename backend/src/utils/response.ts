import { Context } from 'hono';

/**
 * Standard success response
 */
export function success<T>(c: Context, data: T, status = 200) {
  return c.json({ success: true, data }, status as any);
}

/**
 * Standard error response
 */
export function error(c: Context, code: string, message: string, status = 400, details?: unknown) {
  return c.json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) }
  }, status as any);
}

/**
 * Common error responses
 */
export const Errors = {
  validation: (c: Context, details: unknown) =>
    error(c, 'VALIDATION_ERROR', 'Invalid input data.', 400, details),
  notFound: (c: Context, entity = 'Resource') =>
    error(c, `${entity.toUpperCase()}_NOT_FOUND`, `${entity} not found.`, 404),
  unauthorized: (c: Context) =>
    error(c, 'UNAUTHORIZED', 'Authentication required.', 401),
  forbidden: (c: Context) =>
    error(c, 'FORBIDDEN', 'Access denied.', 403),
  conflict: (c: Context, message: string) =>
    error(c, 'CONFLICT', message, 409),
  rateLimited: (c: Context) =>
    error(c, 'RATE_LIMITED', 'Too many requests. Please try again later.', 429),
  internal: (c: Context) =>
    error(c, 'INTERNAL_ERROR', 'Something went wrong. Please try again.', 500),
};
