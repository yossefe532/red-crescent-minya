import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { debugLogger } from './middleware/debug';
import { ownershipMiddleware } from './middleware/ownership';
import { Env } from './env';
import { success, error } from './utils/response';
import { publicRoutes } from './routes/public';
import { adminRoutes } from './routes/admin';
import { publicRegistrationRoutes } from './routes/registration';
import { quickRoutes } from './routes/quick';
import { telegramRoutes } from './routes/telegram';
import { selfCancelRoutes } from './routes/self-cancel';

const app = new Hono<{ Bindings: Env }>();

// Enable CORS
app.use('*', cors({
  origin: [
    'http://localhost:5173', 
    'http://localhost:3000',
    'https://red-crescent-minya.pages.dev',
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Auth-Token', 'Cookie'],
  credentials: true,
}));

// Debug logging for development
app.use('*', debugLogger);

// Health endpoint
app.get('/health', (c) => {
  return success(c, {
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT || 'development',
    version: '1.0.0-mvp',
  });
});

// Public routes (mission info, volunteer lookup)
app.use('/api/missions/*', ownershipMiddleware);
app.use('/api/register*', ownershipMiddleware);
app.use('/api/register-temporary', ownershipMiddleware);
app.route('/api', publicRoutes);
app.route('/api/public', publicRoutes);

// Public registration routes (no auth required)
app.route('/api', publicRegistrationRoutes);

// Quick profile and temporary registration routes
app.route('/api', quickRoutes);

// Self-cancellation + my-registrations (ownership-authenticated)
app.route('/api', selfCancelRoutes);

// Admin routes (with authentication)
app.route('/api/admin', adminRoutes);

// Telegram bot webhook (receives POST from Telegram servers)
app.route('/telegram', telegramRoutes);

// 404 handler
app.notFound((c) => {
  return error(c, 'NOT_FOUND', 'Route not found', 404);
});

// Global error handler
app.onError((err, c) => {
  console.error('Global error:', err);
  return error(c, 'INTERNAL_ERROR', 'Internal server error', 500);
});

// ─── Scheduled Notification Processor ─────────────────────────
// Cloudflare Workers runs this on the cron trigger defined in wrangler.toml.
// It drains the notification_events outbox and sends Telegram messages with retry/backoff.
async function scheduled(
  controller: any,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const { processPendingNotifications } = await import('./services/notification_outbox');
  const token = env.TELEGRAM_BOT_TOKEN;
  const adminChatIds = env.ADMIN_CHAT_IDS;

  if (!token || !adminChatIds) {
    console.log('[NOTIFICATION PROCESSOR] Missing token or adminChatIds');
    return;
  }

  ctx.waitUntil(
    (async () => {
      try {
        const result = await processPendingNotifications(env.DB, token, adminChatIds);
        console.log(`[NOTIFICATION PROCESSOR] sent=${result.sent} failed=${result.failed} retried=${result.retried}`);
      } catch (error) {
        console.error('[NOTIFICATION PROCESSOR] Error:', error);
      }
    })()
  );
}

// Cloudflare Workers ES Module format requires both handlers in default export
export default {
  fetch: app.fetch,
  scheduled,
};