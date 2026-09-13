# HANDOFF TO EXTERNAL ENGINEER — Complete System Audit
**Date:** 2026-09-13 | **Project:** Red Crescent Minya Volunteer Registration
**Purpose:** Full system documentation for Telegram Bot rebuild/restructure

---

## 1. Project Overview
Red Crescent Minya — Volunteer registration system for mission-based volunteering.
- Backend: Cloudflare Workers / D1 / Hono / TypeScript
- Frontend: React / Vite / TailwindCSS (Cloudflare Pages)
- Telegram Bot: Grammy v2 (webhook-based)
- DB: Cloudflare D1 (SQLite-compatible)
- Storage: R2 (primary audio) + D1 base64 fallback

## 2. Current Architecture
See ARCHITECTURE_MAP.md for diagram.

## 3. Technology Stack
- Frontend: React 18, Vite, TypeScript, TanStack Query, react-router-dom, TailwindCSS
- Backend: Hono, TypeScript, Cloudflare Workers
- DB: D1 (raw SQL, no ORM), Zod validation
- Telegram: Grammy v2, webhook
- Storage: R2 + D1 base64

## 4. Database Models
See DATABASE_MAP.md for full table inventory. Key tables: missions, volunteers, registrations, audio_confirmations, admin_users, admin_sessions, settings, telegram_sessions.

## 5. API Endpoints
See API_MAP.md for full endpoint list (public + admin + telegram).

## 6. Task Lifecycle
- Create: Admin Panel or Telegram wizard (7-step)
- Edit: Admin Panel or Telegram (limited fields)
- Delete: Admin Panel or Telegram wizard
- Open: Set registration_open_at, clear registration_close_at, status=OPEN
- Close: Set registration_close_at=now, status=CLOSED
- **REOPEN: DOES NOT EXIST** — confirmed bug (BUG-002)
- Auto-close: When capacity + waitlist full
- Statuses: DRAFT, OPEN, CLOSED, CANCELLED, COMPLETED

## 7. Volunteer Lifecycle
CONFIRMED → CANCELLED (admin only)
WAITLIST → CONFIRMED (promote) / CANCELLED
No self-cancellation by volunteer.

## 8. Waiting List Lifecycle
- Automatic: when capacity full, next registrant → WAITLIST
- Auto-promote on cancel
- Auto-close when both full

## 9. Recording Lifecycle
- Browser MediaRecorder → webm
- POST /api/register (multipart or base64 JSON)
- R2 storage (key: missions/{mid}/registrations/{regId}.webm)
- D1 base64 fallback
- Retrieved: GET /api/admin/registrations/:regId/audio

## 10. Telegram Commands
/start, /help, /cancel + text intents (Egyptian Arabic NLP)
16 intent types: create_mission, list_missions, list_active, stats, status, help, open_mission, close_mission, delete_mission, cancel_registration, view_waitlist, view_registrants, edit_mission, export_csv, get_link, unknown

## 11. Telegram Callbacks
7 prefix groups: nav:*, m:*, v:*, wiz:*, confirm:*, edit:field:*, delete:pick:*, notify:*
~40+ unique callbacks total. See TELEGRAM_CALLBACK_MAP.md for full list.

## 12. Telegram Permissions
- isAuthorizedChat() on every webhook hit
- ADMIN_CHAT_IDS from ENV (comma-separated)
- No per-callback permission check — all or nothing

## 13. Website ↔ Backend Flow
- React fetch() with cookie credentials
- Auth: X-Auth-Token header or rc_session cookie
- TanStack Query for caching/polling
- Optimistic updates in MissionControlPanel
- Polling: /status every 1s, /registrations-live every 6s

## 14. Telegram ↔ Backend Flow
- Webhook POST → /telegram
- Auth: chat ID check
- Handlers call mission.service.ts directly (D1 queries)
- No separate service layer for Telegram

## 15. Real-Time Notification Flow
- Registration → sendTelegramRegistrationNotification (fire-and-forget)
- Direct Telegram API calls, no queue/retry
- Per-mission toggle: missions.telegram_notifications
- Global toggle: settings.notifications_enabled

## 16. Admin Panel Feature Inventory
Full CRUD missions, toggle registration, cancel/promote registrations, view recordings, export CSV, WhatsApp message, live registrations, stats, health check, notification settings.

## 17. Telegram Feature Inventory
Same features as admin panel via wizard + callbacks, minus: reopen mission, live feed, quick registration, temporary registration, member ID lookup, registration status check.

## 18. Feature Parity Gaps
- REOPEN mission: MISSING
- Live registration feed: MISSING
- Quick registration: MISSING
- Temporary registration: MISSING
- Member ID lookup: MISSING
- Registration status check: MISSING

## 19. Current Bugs
1. BUG-001: close/open mission intents route to delete wizard (intent.ts)
2. BUG-002: No reopen action anywhere
3. BUG-003: REJECTED status not in DB CHECK constraint
4. BUG-004: actorId hardcoded 'telegram' in toggle handler
5. BUG-005: Inconsistent error handling (tgSend throws, tgEdit silent)
6. BUG-006: Notification after HTTP response (fire-and-forget after return)

## 20. Potential Bugs
1. Race condition on last seat (no locking)
2. MNY code collision (random, no retry)
3. Audio D1 fallback corruption risk
4. No timeout on Telegram API calls
5. Route ordering: publicRoutes + regRoutes both under /api
6. D1 BLOB column migration issue
7. Frontend 1s polling can hammer backend

## 21. Missing Reverse Actions
- CLOSE → REOPEN: MISSING
- CANCEL registration → RESTORE: MISSING

## 22. Concurrency Risks
- Last seat race condition (no DB transaction)
- Simultaneous capacity updates
- Duplicate callback handling (no idempotency key)
- Duplicate notifications (fire-and-forget, no dedup)

## 23. Security Risks
- Admin auth: simple token in cookie, SHA-256 password hash (no bcrypt)
- No per-callback auth — once chat authorized, all actions allowed
- No rate limiting on Telegram webhook
- Admin IDs in ENV (acceptable)
- Password hash uses static salt (weak)

## 24. Performance Risks
- Frontend polls /status every 1s per user
- No caching on Telegram handlers (every callback hits D1)
- Audio base64 in D1 can exceed size limits
- No pagination on registration lists in some endpoints
- Sequential admin notification sends (blocking)

## 25. Future-Proofing Problems
- No service layer — handlers call DB directly
- No event system — notifications embedded in registration handler
- No shared types between Website/Telegram
- Business logic duplicated: cancel+promote logic exists in admin.ts AND cancel-reg.ts
- Adding new feature to Website requires manual Telegram update (no automation)
- No API contracts — all communication via direct DB access

## 26. Recommended Architecture Direction
1. Introduce Service Layer between handlers and DB
2. Event-driven notifications (emit → consume)
3. Shared domain types across Website/Telegram
4. Proper state machine with reverse transitions
5. Database transactions for seat allocation
6. Queue for Telegram notifications
7. Per-callback authorization
8. Pagination on all list endpoints
9. Rate limiting on public endpoints
10. Proper password hashing (bcrypt)

---

**DO NOT MODIFY ANYTHING BASED ON THIS REPORT.**
This is a read-only audit. All recommendations are for future implementation planning only.
