# ARCHITECTURE MAP
**Date:** 2026-09-13

```
┌─────────────────────────────────────────────────────┐
│                    FRONTEND (React/Vite)             │
│   AdminDashboard  |  MissionControlPanel  |          │
│   MissionRegistration (public signup)                │
└──────────────┬──────────────────────┬────────────────┘
               │ HTTP (fetch+cookie)  │ HTTP (multipart)
               ▼                      ▼
┌─────────────────────────────────────────────────────┐
│              CLOUDFLARE PAGES (Frontend Host)        │
│              red-crescent-minya.pages.dev            │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER (Backend)             │
│              Hono TypeScript Router                  │
│                                                      │
│  /api/admin/*    → adminRoutes (auth required)       │
│  /api/*          → publicRoutes + regRoutes          │
│  /telegram       → telegramRoutes (webhook)          │
│  /health         → health endpoint                   │
└──────┬──────────────────┬──────────────────┬────────┘
       │                  │                  │
       ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   D1 DB      │  │   R2 Bucket  │  │  Telegram    │
│  (SQLite)    │  │ (audio)      │  │  API         │
│              │  │              │  │              │
│ missions     │  │ red-crescent │  │ sendMessage  │
│ volunteers   │  │ -minya-audio │  │ sendVoice    │
│ registrations│  │              │  │ editMessage  │
│ audio_conf.  │  │              │  │ sendDocument │
│ admin_users  │  │              │  │              │
│ admin_sess.  │  │              │  │              │
│ audit_logs   │  │              │  │              │
│ settings     │  │              │  │              │
│ telegram_sess│  │              │  │              │
│ quick_prof.  │  │              │  │              │
│ temp_regist. │  │              │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
```

## Data Flow
### Website Registration
User → Frontend → POST /api/register → Hono → D1 (transaction-like) → R2 audio → Telegram notification (fire-and-forget) → Response

### Telegram Interaction
Telegram → Webhook → Hono → isAuthorizedChat → callback/command handler → service → D1 → Telegram response
