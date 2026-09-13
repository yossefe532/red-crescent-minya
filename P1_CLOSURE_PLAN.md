# PER-CALLBACK AUTHORIZATION + NOTIFICATION OUTBOX
## Implementation Plan

## GAP 3 — Per-Callback Authorization

Current state: `isAuthorizedChat` only at webhook entry (telegram.ts line 60)
Missing: per-callback admin check in handleCallbackQuery

## Implementation Plan

### Phase 1 — Centralized Authorization Helper

Create `backend/src/telegram/auth.ts`:
```typescript
export async function requireTelegramAdmin(
  token: string,
  chatId: number,
  db: D1Database,
  ADMIN_CHAT_IDS: string | undefined
): Promise<boolean> {
  if (!ADMIN_CHAT_IDS) return true; // First-contact mode
  if (!isAuthorizedChat(chatId, ADMIN_CHAT_IDS)) {
    await tgSend(token, chatId, '⛔ غير مصرح لك.');
    return false;
  }
  return true;
}
```

### Phase 2 — Apply to Sensitive Callbacks

In `callbacks.ts`, add auth check at the start of each sensitive handler:
- handleDelete (delete:pick, delete:execute)
- handleCancelReg (cancelreg:mission, cancelreg:vol)
- handleNotify (notify:on, notify:off)
- handleMission (close, open, reopen actions)
- handleVolunteerMove (waiting list operations)
- handleVolunteerAudio (recording access)

### Phase 3 — Authorization Matrix

| Action | Auth Required | Current | Status |
|--------|--------------|---------|--------|
| delete | YES | NO | NEEDS FIX |
| close | YES | NO | NEEDS FIX |
| reopen | YES | NO | NEEDS FIX |
| cancel | YES | NO | NEEDS FIX |
| promote | YES | NO | NEEDS FIX |
| reject | YES | NO | NEEDS FIX |
| waiting list | YES | NO | NEEDS FIX |
| recording access | YES | NO | NEEDS FIX |
| settings | YES | NO | NEEDS FIX |
| notification settings | YES | NO | NEEDS FIX |
| view missions | YES | NO | NEEDS FIX |
| list registrants | YES | NO | NEEDS FIX |

## GAP 4 — DB Idempotency

### Phase 2A — Registration Idempotency

Add UNIQUE constraint: `registration(telegram_user_id, mission_id)`
Or use idempotency key approach with `notification_events` table

### Phase 2B — Waiting Promotion Idempotency

Atomic UPDATE with WHERE status='WAITING'

### Phase 2C — Cancellation Idempotency

Check status before cancel: only CANCELLED if status != CANCELLED

### Phase 2D — Mission State Transitions

Validate state transitions in service layer

## GAP 2 — Notification Outbox (D1-backed)

### Outbox Table Schema

```sql
CREATE TABLE notification_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  chat_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  attempts INTEGER DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT DEFAULT datetime('now'),
  processed_at TEXT,
  last_error TEXT
);
```

### Notification Flow

```
Registration transaction:
  BEGIN
    -> create/update registration
    -> allocate seat
    -> create notification event (PENDING)
  COMMIT

Processor (scheduled trigger or on-demand):
  -> SELECT PENDING notifications WHERE next_attempt_at <= now
  -> Send Telegram
  -> UPDATE status = SENT/FAILED
  -> Retry with exponential backoff
```

### Retry Policy

- Max 5 attempts
- Exponential backoff: 1, 2, 4, 8, 16 minutes
- Only retry transient errors (timeout, 5xx, network)
- Max delay: 1 hour

### Idempotency

- Each notification_event has unique ID (registrationId + notificationType + timestamp)
- Processor checks idempotency before sending
- Same event = at most one successful logical notification

## PHASE 5 — Recording Reliability

R2 = primary storage
D1 base64 = fallback only

## PHASE 6 — NOTIFICATION FAILURE DOES NOT FAIL REGISTRATION

Registration transaction succeeds independently of Telegram notification.
Notification event created in same transaction but processed asynchronously.

## PHASE 8 — Password Hash Migration (P2)

Migration plan:
- Legacy: SHA-256 + static salt
- Target: Web Crypto API (SubtleCrypto)
- Strategy: legacy hash -> successful login -> rehash -> save new hash
- No forced reset
- Backward compatible

## HARD STOP RULE

If any change requires major rearchitecture:
STOP.
Log: ARCHITECTURAL DECISION REQUIRED
With: current architecture, problem, options, risk, recommended direction.
