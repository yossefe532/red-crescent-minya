export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  AUDIO_RETENTION_DAYS: string;
  ADMIN_AUTH_SECRET?: string;
  TURNSTILE_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  ADMIN_CHAT_IDS?: string;
  AI_API_KEY?: string;
  AI?: any;
}

export default {
  async scheduled(controller: any, env: Env, ctx: any): Promise<void> {
    const token = env.TELEGRAM_BOT_TOKEN;
    const adminChatIds = env.ADMIN_CHAT_IDS;

    if (!token || !adminChatIds) {
      console.log('[NOTIFICATION PROCESSOR] Missing token or adminChatIds');
      return;
    }

    const { processPendingNotifications } = await import('../services/notification_outbox');
    const db = env.DB;

    try {
      const result = await processPendingNotifications(db, token, adminChatIds);
      console.log(`[NOTIFICATION PROCESSOR] sent=${result.sent} failed=${result.failed} retried=${result.retried}`);
    } catch (error) {
      console.error('[NOTIFICATION PROCESSOR] Error:', error);
    }
  },

  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
    return new Response('Notification processor is a scheduled worker', { status: 200 });
  },
};
