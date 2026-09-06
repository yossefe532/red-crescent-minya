export interface Env {
  DB: D1Database;
  AUDIO_BUCKET: R2Bucket;
  ENVIRONMENT: string;
  FRONTEND_URL: string;
  AUDIO_RETENTION_DAYS: string;
  ADMIN_AUTH_SECRET?: string;
  TURNSTILE_SECRET?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    adminId: string;
    adminUsername: string;
  };
};
