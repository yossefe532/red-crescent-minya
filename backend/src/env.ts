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
  AI_API_KEY?: string;       // Cloudflare Workers AI API key
  AI?: any;                  // Workers AI binding (for Telegram NLU)
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    adminId: string;
    adminUsername: string;
  };
};
