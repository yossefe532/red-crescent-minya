# Bug Analysis — Red Crescent Minya System

## System Architecture Summary

### Frontend
- React + Vite + TailwindCSS
- `frontend/src/pages/AdminDashboard.tsx` — Main admin panel (820 lines)
- `frontend/src/pages/MissionControlPanel.tsx` — Mission control
- `frontend/src/pages/MissionRegistration.tsx` — Public registration
- `frontend/src/api/admin.ts` — API client
- `frontend/src/lib/api.ts` — Base API

### Backend (Cloudflare Workers / Hono)
- `backend/src/index.ts` — Main entry, routes
- `backend/src/routes/admin.ts` — Admin API (711 lines)
- `backend/src/routes/telegram.ts` — Telegram bot (1400+ lines, recently rewritten)
- `backend/src/routes/public.ts` — Public API
- `backend/src/routes/registration.ts` — Volunteer registration
- `backend/src/routes/quick.ts` — Quick registration
- `backend/src/services/mission.service.ts` — Mission CRUD
- `backend/src/services/admin.service.ts` — Admin auth/session
- `backend/src/services/audit.service.ts` — Audit logging
- `backend/src/middleware/auth.ts` — Admin auth middleware
- `backend/src/env.ts` — Environment types
- `backend/src/validation/admin.schema.ts` — Zod validation

### Database (D1 SQLite)
- `backend/migrations/0001_init.sql` — Base schema
- `backend/migrations/0002_add_phone_and_quick_register.sql`
- `backend/migrations/0003_audio_blob.sql`
- `backend/migrations/0004_telegram_sessions.sql`

---

## BUG-01: Create Mission Freezes / No Result / Buttons Stop

### Root Cause
**`setCreatingMission(true)` blocks UI but no error boundary on the backend response.**

The flow in `AdminDashboard.tsx` `handleCreateMission` (line 171):
1. `setCreatingMission(true)` — disables button
2. `await createMission(...)` — POST to `/api/admin/missions`
3. On success: `setCreateModalSuccess(created)` + `loadMissionsList()`
4. On error: `alert(err.message)` — but `alert()` in Safari/Chrome mobile blocks the thread
5. `finally { setCreatingMission(false) }` — should reset

**BUT**: The real problem is in `backend/src/routes/admin.ts` line 72-97:
- `createMissionSchema.safeParse(body)` — Zod schema may reject unknown fields
- `createMission(c.env.DB, parsed.data as Record<string, unknown>)` — passes to service
- The service does a raw INSERT with `.bind()` — if the schema expects `waiting_list` but the schema doesn't include it, it silently ignores
- **Critical**: If the schema validation passes but the DB insert fails (e.g., capacity field mismatch, missing `registration_open_at`), the error propagates but the `alert()` in frontend only shows after the entire async chain completes

**Another problem**: `createMission` in the service uses `db.prepare(...).run()` which can succeed but the `getMissionById` after insert might return null if the transaction hasn't committed — D1 is eventually consistent.

**Third problem**: The `handleCreateMission` does `e.preventDefault()` but if `createMission` throws a promise rejection that's NOT caught by try/catch (due to unhandled async), `setCreatingMission` stays `true` forever → UI freezes.

### Fix Plan
1. Add `try/catch` with proper error boundaries in `handleCreateMission`
2. Add `console.error` in service for debugging
3. Ensure `finally { setCreatingMission(false) }` always runs even on unhandled rejection
4. Add timeout to fetch request
5. Validate `capacity` and `waiting_list` before schema

---

## BUG-02: Delete Mission — Shows Confirmation but Doesn't Execute

### Root Cause
**Event handler conflict between confirmation dialog and delete execution.**

Looking at `AdminDashboard.tsx`:
- Line ~350+ shows delete button for each mission
- The delete flow likely has `onClick` handler that shows `confirm()` dialog
- But the `onClick` may fire twice: once from the button itself, once from a parent element's click propagation
- **Or**: The `confirm()` dialog returns `true` but the handler after `confirm()` is either:
  a) Not properly chained
  b) Using `event.preventDefault()` that cancels the subsequent `fetch`
  c) The delete API call returns `success` but the UI doesn't update because `setMissions` doesn't re-fetch

**Critical finding**: In `admin.ts` line 329-350, the DELETE endpoint returns `{ message: 'Mission deleted.' }` on success. The frontend must handle this response and call `loadMissionsList()` or filter the mission from state. If the response handler is missing or broken, the mission appears deleted but reappears on refresh.

### Fix Plan
1. Trace the delete button `onClick` handler in `AdminDashboard.tsx`
2. Ensure single `onClick` (not bubbling)
3. Call `loadMissionsList()` after successful delete
4. Add proper error handling

---

## BUG-03: Telegram Admin Operations Not Working Correctly

### Root Cause
**Multiple issues in the recent rewrite:**

1. **Route duplication**: `telegram.ts` has `telegramRoutes.post('/telegram', ...)` AND index.ts mounts at `/telegram` → full path becomes `/telegram/telegram` (should be `/telegram`)
2. **AI binding not resolving**: The Workers AI binding `env.AI` may not be properly configured in the production environment — the `@cf/meta/llama-3.3-70b-instruct` model may not be available on free tier
3. **Callback data mismatch**: Inline keyboard callbacks may not match the handler cases
4. **Missing waiting list field**: Missions don't have `waiting_list` field in DB schema yet

### Fix Plan
1. Fix route mounting (`telegramRoutes.post('/', ...)` in index.ts)
2. Use `@cf/meta/llama-3.1-8b-instruct` (confirmed available)
3. Add `waiting_list` column to missions table
4. Verify AI binding works

---

## BUG-04: No Audio Playback from Telegram

### Root Cause
**Telegram bot has no mechanism to play audio recordings to admins.**

The current `telegram.ts` has:
- `handleListRegistrations` — lists registrations but no audio playback
- `handleViewWaitlist` — lists waitlist but no audio
- No `/play` or `/listen` command

The audio is stored in D1 as base64 in `audio_data` column (from `0003_audio_blob.sql`). To play in Telegram, we need to:
1. Decode base64 → binary
2. Send as Telegram `voice` or `audio` message via `sendVoice` API
3. Include volunteer info alongside

### Fix Plan
1. Add `/play` command to telegram.ts
2. Decode base64 audio data from D1
3. Use `fetch("https://api.telegram.org/bot{TOKEN}/sendVoice", { files: [{audio: audioBuffer}] })`
4. Include volunteer name, membership, mission info

---

## FEATURE-01: No Waiting List Per Mission

### Current State
- `missions` table has `capacity` but NO `waiting_list` column
- `registrations` table has `waitlist_position` and `status = 'WAITLIST'`
- But there's no way to CONFIGURE the waiting list capacity per mission
- The system defaults to unlimited waitlist

### Required
- Add `waiting_list` column to `missions` table (default: 0)
- When `waiting_list > 0`, accept registrations up to `waiting_list` capacity after `capacity` is full
- When `waiting_list = 0`, auto-close registration at `capacity`

---

## FEATURE-02: No Auto-Close on Capacity Reached

### Current State
- `status` field exists (`DRAFT`, `OPEN`, `CLOSED`, `CANCELLED`, `COMPLETED`)
- But registration is never automatically closed when `capacity` is reached
- `registration_open_at` and `registration_close_at` exist but are not managed automatically
- `getMissionAvailability` returns `available = capacity - confirmed` but nothing checks this

### Required
- After each successful registration, check if `confirmed >= capacity`
- If yes and `waiting_list = 0`: set `status = 'CLOSED'`, `registration_close_at = now()`
- If yes and `waiting_list > 0`: keep accepting waitlist until `waitlist >= waiting_list`
- Update `registration_open_at`/`registration_close_at` accordingly

---

## FEATURE-03: No Real-Time Website ↔ Telegram Sync

### Current State
- Website registration → D1 → nothing to Telegram
- Telegram bot → D1 → nothing to Website
- No webhook-based notification from backend to Telegram on registration
- No polling-based sync from Website → Telegram
- Admin can toggle `telegram_notifications` in database

### Required
- Add `telegram_notifications` column to `missions` table (default: 1/true)
- On registration INSERT, if mission's `telegram_notifications = true`, send Telegram notification
- Notification includes: volunteer name, membership, mission, status, audio voice message
- Use async background task (Workers cron or queue) for reliable delivery
- Admin can toggle via `POST /api/admin/missions/:id/toggle-notifications`

---

## Race Condition Protection

### Current State
- `getMissionAvailability` does `SELECT COUNT(*)` then `INSERT` — not atomic
- Two concurrent registrations at capacity can BOTH pass the check

### Required
- Use D1 `BEGIN TRANSACTION` / `COMMIT` or optimistic locking
- Use `SELECT ... WHERE capacity > confirmed` for seat claim
- Or use `UPDATE registrations SET seat_number = ? WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number = ?` with row-level lock

---

## Summary Table

| Bug/Feature | Severity | Root Cause | Fix Location |
|-------------|----------|-----------|-------------|
| BUG-01 Create freeze | High | Unhandled promise rejection, missing error boundary | AdminDashboard.tsx + mission.service.ts |
| BUG-02 Delete ghost | High | Missing state update after delete, event propagation | AdminDashboard.tsx |
| BUG-03 Telegram broken | High | Route mismatch, missing waiting_list field, AI binding | telegram.ts + index.ts |
| BUG-04 No audio in TG | Medium | No sendVoice endpoint | telegram.ts |
| FEATURE-01 Waiting list | High | Missing column, no config | migrations + mission.service.ts |
| FEATURE-02 Auto-close | High | No post-registration check | registration.ts + mission.service.ts |
| FEATURE-03 Real-time sync | High | No notification trigger | registration.ts + telegram.ts |
| Race conditions | High | Non-atomic seat claiming | registration.ts |

---

## Priority Order
1. BUG-01 (Create freeze) — blocks all functionality
2. BUG-02 (Delete ghost) — data integrity risk
3. BUG-03 (Telegram broken) — blocking Telegram integration
4. FEATURE-01 (Waiting list) — foundational for FEATURE-02
5. FEATURE-02 (Auto-close) — blocks registration
6. FEATURE-03 (Real-time sync) — requires FEATURE-01
7. BUG-04 (Audio in Telegram) — UX improvement
8. Race conditions — critical but works at edge cases
