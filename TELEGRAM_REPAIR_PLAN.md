# TELEGRAM REPAIR PLAN
**Date:** 2026-09-13 | **Project:** Red Crescent Minya
**Reference:** HANDOFF_TO_EXTERNAL_ENGINEER.md + all audit files
**Rule:** Read-only audit complete → now implementing ONLY in Telegram layer

---

## Priority Order

### P0 — Critical (broken behavior)

| ID | Bug | Fix |
|----|-----|-----|
| P0-1 | close/open intents route to delete wizard | Fix intent.ts routing |
| P0-2 | No REOPEN action | Add REOPEN to mission lifecycle |
| P0-3 | REJECTED status not in DB CHECK constraint | Add REJECTED to schema or remove usage |
| P0-4 | Race condition on last seat | Atomic UPDATE with WHERE capacity check |

### P1 — High (data integrity / security)

| ID | Bug | Fix |
|----|-----|-----|
| P1-1 | actorId hardcoded 'telegram' | Pass admin chatId from session |
| P1-2 | No per-callback authorization | Add auth check inside each sensitive callback |
| P1-3 | SHA-256 password with static salt | Upgrade to bcrypt-like (Web Crypto PBKDF2) |
| P1-4 | No timeout on Telegram API calls | Add AbortController with timeout |
| P1-5 | Callback idempotency — double delete/promote | State check + atomic UPDATE with WHERE |

### P2 — Medium (reliability / UX)

| ID | Bug | Fix |
|----|-----|-----|
| P2-1 | Inconsistent error handling (tgSend throws) | Wrap all tg* calls in try/catch, uniform pattern |
| P2-2 | Notification sent after HTTP response | Move notification before response OR use background queue |
| P2-3 | MNY code collision risk | Check collision, retry on conflict |
| P2-4 | 1s frontend polling | Increase to 5s + event-driven invalidation |
| P2-5 | D1 base64 audio fallback corruption | Add validation, size limit, consistent format |
| P2-6 | Route ordering conflict (/missions/:id/audio vs /missions/:id) | Reorder routes, use explicit paths |

### P3 — Low (minor)

| ID | Bug | Fix |
|----|-----|-----|
| P3-1 | No rate limiting on Telegram webhook | Simple per-chat rate limiter |
| P3-2 | No retry for failed Telegram sends | Exponential backoff, max 3 retries |
| P3-3 | Stale callback handling | Check mission status before executing |
| P3-4 | No Telegram session isolation | Already D1-based (per chat_id) — verify |

---

## Implementation Phases

### Phase A — Backend Fixes (no Telegram change)
1. Fix intent routing (P0-1)
2. Add REOPEN (P0-2) — needs DB schema change
3. Fix REJECTED status (P0-3)
4. Atomic seat allocation (P0-4)
5. Actor identity (P1-1)
6. Route ordering (P2-6)

### Phase B — Telegram Hardening
7. Unified error handling (P2-1)
8. Timeouts (P1-4)
9. Per-callback auth (P1-2)
10. Callback idempotency (P1-5)
11. Stale callback protection (P3-3)
12. Rate limiting (P3-1)

### Phase C — Notifications & Recording
13. Real-time notification architecture (P2-2)
14. Send recording to Telegram (P12)
15. Idempotent notifications (P11)
16. Registration event (P10)

### Phase D — Verification
17. Test matrix
18. E2E test
19. Regression test
20. Static audit
21. Final report

---

## Database Changes Required

```sql
-- P0-2: Add REOPEN capability (status stays CLOSED but registration reopens)
-- No new status needed — toggle registration_open_at + status = OPEN
-- REOPEN = open registration without changing mission status to DRAFT

-- P0-3: Add REJECTED to registrations CHECK constraint
ALTER TABLE registrations DROP CONSTRAINT registrations_status_check;
ALTER TABLE registrations ADD CONSTRAINT registrations_status_check
  CHECK (status IN ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED', 'REJECTED'));

-- P0-4: No schema change — atomic UPDATE pattern

-- P2-5: Audio validation — no schema change
```

## Files to Modify

### Backend
- `src/telegram/intent.ts` — P0-1 (close/open routing)
- `src/services/mission.service.ts` — P0-2 (reopen), P0-4 (atomic allocation)
- `src/routes/registration.ts` — P0-4 (atomic), P2-2 (notification timing)
- `src/routes/admin.ts` — P0-3 (REJECTED handling), P1-1 (actor identity)
- `src/telegram/commands/toggle.ts` — P0-2 (reopen support)
- `src/telegram/bot.ts` — P2-1 (error handling), P1-4 (timeouts)
- `src/telegram/callbacks.ts` — P1-2 (per-callback auth), P1-5 (idempotency), P3-3 (stale check)
- `src/middleware/auth.ts` — P1-3 (password hash upgrade)
- `src/validation/admin.schema.ts` — P0-3 (REJECTED in types)
- `src/routes/telegram.ts` — P3-1 (rate limiting)

### Frontend (minimal)
- `src/pages/MissionRegistration.tsx` — P2-4 (polling interval)

### Migrations
- `backend/migrations/0006_reopen.sql` — P0-2
- `backend/migrations/0007_rejected_status.sql` — P0-3

---

## What NOT to Touch
- Frontend AdminDashboard.tsx (working, only polling change)
- Website registration flow (except atomic seat fix)
- R2 storage mechanism
- Grammy framework
- D1 database engine
