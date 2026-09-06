import { Context, Next } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';

// Middleware to log all requests for debugging
export async function debugLogger(c: Context<{ Bindings: Env }>, next: Next) {
  const start = Date.now();
  console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path}`);
  
  try {
    await next();
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path} - ${c.res.status} (${duration}ms)`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ${c.req.method} ${c.req.path} - ERROR:`, err);
    throw err;
  }
}