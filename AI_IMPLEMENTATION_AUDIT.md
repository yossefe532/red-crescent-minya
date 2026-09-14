# AI Implementation Audit — Red Crescent Minya
## Live Registration System Preparation Phase

**Audit Date:** 2026-09-14  
**Auditor:** HERMES Agent  
**Project:** `D:\harmes jop\red-crescent-minya`  
**Stack:** Cloudflare Workers (Hono) + D1 (SQLite) + R2 + Pages (React+Vite) + TypeScript

---

## 1. Current Architecture

```
Telegram Bot (@minyasc2026_bot)
  ↓ webhook
Cloudflare Worker (Hono)
  ├── /telegram/*         → Telegram command handlers
  ├── /api/register       → Registration endpoints (public + internal)
  ├── /api/missions/:id   → Mission management (admin)
  ├── /api/public/*       → Public-facing mission data
  ├── /admin/*            → Admin panel routes
  └── /quick/*            → Quick registration (phone-first)
        ↓
D1 Database (SQLite)
  ├── missions
  ├── registrations
  ├── volunteers
  ├── waitlist
  ├── notification_events
  └── audio_confirmations
        ↓
R2 Bucket (audio storage)
Pages (React + Vite) → Frontend SPA
```

**Key observation:** The system already has a solid foundation. The audit focuses on identifying what exists vs. what's needed for Live Registration.

---

## 2. Current Registration Flow

```
Volunteer opens mission (Web/Telegram)
  ↓
GET /api/public/mission/:publicCode — check status
  ↓ (if open)
POST /api/register — submit registration
  ├── Validate (schema validation)
  ├── Check capacity (confirmed < capacity)
  ├── Check waitlist (waitlist < waiting_list)
  ├── If full → REJECTED + auto-close mission
  ├── If waitlist full → REJECTED
  ├── Save R2 audio (fallback: D1 base64)
  ├── Create audio_confirmations record
  ├── Log audit entry
  ├── Queue Telegram notification (outbox pattern)
  └── Return { registration_id, status, seat_number, waitlist_position }
  ↓
Frontend polls GET /api/public/mission/:publicCode (5s interval)
  ↓
Admin receives Telegram notification (via outbox consumer)
```

**Problems identified:**
- Polling is 5-second fixed — no backoff, no change detection optimization
- Registration links stay open after capacity is full (auto-close has gaps)
- No instant registration confirmation push to volunteer
- No duplicate submission prevention (client-side only)

---

## 3. Current Mission States

```
OPEN → CLOSED (auto or manual)
CLOSED → OPEN (reopen)
REJECTED (terminal — auto-close triggers on status change)
```

**State transitions (current):**
- `OPEN` → `CLOSED`: capacity full, manual close, registration_close_at passed
- `CLOSED` → `OPEN`: reopen command/toggle
- `REJECTED`: terminal state, no reopen

**Gap:** No `WAITLIST_ONLY` state — waitlist fills but mission stays OPEN until confirmed fills capacity.

---

## 4. Current Registration States

```
PENDING → CONFIRMED (seat available)
PENDING → WAITLIST (waitlist available)
PENDING → REJECTED (full, no waitlist)
CONFIRMED → CANCELLED (volunteer cancels)
CANCELLED → (no reopen — permanent)
WAITLIST → CONFIRMED (seat opens, promote from waitlist)
```

**Gap:** No `PROMOTED` state — waitlist → confirmed is silent, no audit trail for promotion.

---

## 5. Current Waitlist Behavior

- Waitlist position assigned sequentially (MAX + 1)
- No automatic promotion when CONFIRMED cancels
- Waitlist count checked at registration time only
- No waitlist timeout/expiry

**Critical gap for Live Registration:** Real-time waitlist promotion is essential. Current system relies on volunteer re-checking.

---

## 6. Current Telegram Integration

```
Bot receives message/command
  ↓
Handler routes to command module
  ↓
Command executes DB operation
  ↓
Notification queued to outbox (notification_events table)
  ↓
Scheduled worker drains outbox every 60s
  ↓
sendTelegramMessage() → Telegram Bot API
```

**Issues found:**
- Outbox drain interval: 60s — too slow for Live Registration (needs <5s)
- No delivery confirmation back to volunteer
- Telegram notification formatting uses `\n` (broken in HTML mode — should be `<br>`)
- `sendTelegramVoice()` called after return statement — dead code (never executes)
- No retry logic for failed Telegram sends beyond outbox re-drain

---

## 7. Current Database Entities

```sql
missions:
  id, public_code, title, description, status, capacity,
  waiting_list, telegram_notifications, confirmation_phrase,
  registration_open_at, registration_close_at, created_at

registrations:
  id, mission_id, volunteer_id, member_id, name, phone,
  status, seat_number, waitlist_position, registration_sequence,
  created_at, confirmed_at, voice_confirmed_at

volunteers:
  id, member_id, name, phone, created_at

waitlist:
  id, mission_id, registration_id, position, created_at

notification_events:
  id, event_type, registration_id, mission_id, admin_chat_id,
  payload, status, attempts, next_retry_at, created_at

audio_confirmations:
  id, registration_id, phrase, audio_key, duration_ms,
  mime_type, audio_data, created_at
```

**Missing for Live Registration:**
- No `device_token` or `ownership_token` column (required for feature #6, #7)
- No `updated_at` column on registrations (causes D1_ERROR on cancel)
- No `request_id` for idempotency

---

## 8. Exact Files to Modify (Preserve Content, Patch Only)

| File | Action | Reason |
|------|--------|--------|
| `backend/src/routes/registration.ts` | Patch | Auto-close logic, notification formatting, idempotency key |
| `backend/src/routes/public.ts` | Patch | `is_completely_full`, status endpoint, waitlist promotion |
| `backend/src/services/notification_outbox.ts` | Patch | Faster drain interval, retry logic |
| `backend/src/telegram/commands/cancel-reg.ts` | Patch | Remove `updated_at` reference |
| `backend/src/telegram/commands/toggle.ts` | Patch | registration_close_at handling |
| `backend/src/services/mission.service.ts` | Patch | Default registration_close_at = null |
| `backend/src/routes/admin.ts` | Patch | Admin toggle sets registration_close_at = null |
| `frontend/src/pages/MissionRegistration.tsx` | Patch | Polling optimization, change detection |
| `frontend/src/api/public.ts` | Patch | `is_completely_full` in Mission interface |

---

## 9. Exact Files Untouched (DO NOT MODIFY)

| File | Reason |
|------|--------|
| `backend/src/index.ts` | Entry point — stable, no changes needed |
| `backend/src/env.ts` | Environment config — correct |
| `backend/src/telegram/bot.ts` | Bot initialization — stable |
| `backend/migrations/0001_init.sql` | Core schema — do not alter |
| `backend/migrations/0008_registration_unique.sql` | Uniqueness constraint — correct |
| `frontend/src/App.tsx` | Router — stable |
| `frontend/src/main.tsx` | Entry point — stable |

---

## 10. Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| `updated_at` D1_ERROR on cancel | HIGH | Remove from UPDATE query (already patched) |
| Registration links stay open after capacity | HIGH | Auto-close condition fix (already patched, needs verification) |
| Telegram notifications not sending | HIGH | Outbox drain + HTML formatting fix (needs verification) |
| No device ownership tracking | MEDIUM | Must add for Live Registration features |
| Waitlist promotion is manual | MEDIUM | Add automatic promotion trigger |
| 60s notification delay | MEDIUM | Reduce drain interval or add instant delivery |
| No idempotency on registration | MEDIUM | Add `request_id` check |
| R2 audio fallback to D1 base64 | LOW | Monitor D1 size limits |

---

## 11. Proposed Extension Architecture

```
Live Registration Additions (EXTEND only, no rebuild):

1. Device Ownership Module (new)
   backend/src/services/device.service.ts — NEW
   backend/src/routes/device.ts — NEW route
   Migration: add device_token, ownership_token to volunteers

2. Waitlist Promotion Trigger
   backend/src/services/waitlist.service.ts — NEW
   Called on CANCELLED registration → promote first WAITLIST

3. Real-time Notification
   Extend notification_outbox.ts — reduce drain interval
   Add instant push on registration status change

4. Idempotency
   Add request_id check in registration.ts before INSERT

5. Live Status Endpoint
   Extend GET /api/public/mission/:publicCode/status
   Include waitlist positions, next available seat ETA

All additions plug into existing routes/services — no architectural replacement.
```

---

## Audit Summary

- **Total files examined:** 20+
- **Critical issues found:** 4
- **Medium issues:** 3
- **Low issues:** 1
- **Files requiring patches:** 9
- **Files untouched:** 7
- **New modules needed:** 2 (device.service.ts, waitlist.service.ts)
- **Migrations needed:** 1 (device ownership columns)

**Next step:** User confirms audit is sufficient, then begin Phase 1 implementation (Device Ownership Module).

---

*Audit complete. Awaiting user direction.*
