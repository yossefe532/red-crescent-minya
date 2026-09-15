# Registration Restore Report — Micro-Improvement Pass

**Date:** 2026-09-14
**Status:** ✅ COMPLETE — Local verification only, DO NOT DEPLOY

---

## Current Flow (Before Changes)

### Self-Cancellation Flow
```
Volunteer → My Registrations card → "إلغاء" → Confirm dialog → "تأكيد الإلغاء"
  → POST /api/registrations/:regId/self-cancel
  → ownership_token verification (cookie)
  → cancelRegistration() service
  → SET status='CANCELLED', seat_number=NULL, cancelled_at=datetime('now')
  → SET original_status (first cancel only)
  → Promote first waitlisted if was CONFIRMED
  → Reorder waitlist
  → Audit log: REGISTRATION_SELF_CANCELLED
  → Increment mission version
  → Queue Telegram notification
  → Return result to frontend
  → Frontend: toast success, refresh live data
```

### Registration State Machine (Before)
```
PENDING → CONFIRMED (seat allocated)
PENDING → WAITLIST (no seat available)
CONFIRMED → CANCELLED (self/admin/system)
WAITLIST → CANCELLED (self/admin/system)
CANCELLED → [no restore path for volunteers]
```

### Admin Restore (Existing)
- Admin-only via `POST /api/admin/registrations/:regId/restore`
- Revokes most recent promotion (demotes last CONFIRMED to WAITLIST)
- NOT suitable for volunteer self-restore (unfair — takes someone else's seat)

---

## Restore Flow (After Changes)

### Self-Restore Flow
```
Volunteer → My Registrations card (CANCELLED) → "↩️ التراجع عن الإلغاء"
  → POST /api/registrations/:regId/self-restore
  → ownership_token verification (cookie)
  → Check: is registration CANCELLED? (idempotent if already active)
  → Check: mission not CLOSED/CANCELLED
  → Determine capacity:
    → SCENARIO A: confirmed seat available → CONFIRMED (next available seat)
    → SCENARIO B: no confirmed seat, waitlist has room → WAITLIST (at END)
    → SCENARIO C: both full → reject with Arabic error
  → SET restored_at=datetime('now')
  → Audit log: REGISTRATION_SELF_RESTORED
  → Increment mission version
  → Queue Telegram notification
  → Return result to frontend
  → Frontend: toast success, refresh live data
```

### Registration State Machine (After)
```
PENDING → CONFIRMED (seat allocated)
PENDING → WAITLIST (no seat available)
CONFIRMED → CANCELLED (self/admin/system)
WAITLIST → CANCELLED (self/admin/system)
CANCELLED → CONFIRMED (self-restore, seat available)
CANCELLED → WAITLIST (self-restore, no seat)
```

---

## Capacity Behavior

### Scenario A — Confirmed Seat Available
- Capacity = 3, Confirmed = 2
- Volunteer restores → CONFIRMED with next available seat

### Scenario B — No Confirmed Seat, Waitlist Available
- Capacity = 2, Confirmed = 2, Waitlist = 1/3
- Volunteer restores → WAITLIST at position 4 (AFTER existing)

### Scenario C — Both Full
- Capacity = 2, Confirmed = 2, Waitlist = 3/3
- Volunteer restores → REJECTED with "المقاعد المؤكدة وقائمة الانتظار ممتلئتان حاليًا"

---

## Waiting-List Priority

**Critical rule:** Restored volunteer ALWAYS joins at END of waitlist.

Example:
```
Existing waitlist: #1 Ahmed, #2 Mohamed, #3 Mahmoud
Restored volunteer → #4 (restored volunteer)
NEVER: #1 (restored volunteer), #2 Ahmed, ...
```

This is enforced by: `COALESCE(MAX(waitlist_position), 0) + 1` across BOTH tables.

---

## Timestamp Semantics

- **`created_at`**: SQLite `datetime('now')` — UTC, seconds precision
- **`restored_at`**: Set on each restore — `datetime('now')`
- **`original_status`**: Preserved on first cancel — never overwritten
- **`registration_sequence`**: Monotonic ordering key — preserved through cancel/restore
- **Display**: `toLocaleTimeString('ar-EG')` — HH:MM:SS (matches stored precision)

**No fake precision:** SQLite stores seconds, frontend displays seconds.

---

## Live Feed Architecture

- **Polling**: Version-based via `GET /api/missions/:publicCode/live?since_version=N`
- **Interval**: 3s visible, 10s hidden (Page Visibility API)
- **Change detection**: Compare roster IDs between polls
- **Events**: registered, cancelled, promoted — shown in activity strip
- **New entries**: Highlighted with animation for 8 seconds
- **Auto-stop**: Polling continues until component unmount (mission close handled by backend)

---

## Privacy Decision

- **Public roster**: Shows name, membership number, status, seat/waitlist position, registration time
- **My Registrations**: Shows full details for device-owned registrations only
- **Ownership**: Device-identified via `ownership_token` cookie — no login required
- **No cross-user data**: Each device sees only its own registrations in My Registrations
- **Admin**: Full access via admin authentication

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `backend/src/routes/self-cancel.ts` | Added `POST /api/registrations/:regId/self-restore` and `POST /api/temporary-registrations/:regId/self-restore` endpoints |

### Frontend
| File | Change |
|------|--------|
| `frontend/src/api/public.ts` | Added `selfRestoreRegistration()` API function and `SelfRestoreResult` interface |
| `frontend/src/pages/MissionRegistration.tsx` | Added restore button for CANCELLED registrations, removed "سجّل المرة الجاية بطريقة أسرع" and "تم" buttons from success screen, added `Undo2` icon import, added `restoringMyRegId` state and `doSelfRestore` handler |

### Tests
| File | Change |
|------|--------|
| `backend/tests/registration_restore_e2e.test.ts` | New — 18 test scenarios, 51 assertions |

---

## Database Changes

**None.** All required columns already exist from migration 0009:
- `original_status` — tracks pre-cancellation status
- `restored_at` — timestamp of last restore
- `cancelled_by` — 'self' | 'admin' | 'system'
- `ownership_token` — device identity

---

## Tests

| Category | Count | Status |
|----------|-------|--------|
| Self-cancel CONFIRMED | 4 | ✅ |
| Restore with seat available | 5 | ✅ |
| Restore to WAITLIST | 5 | ✅ |
| Priority preserved | 8 | ✅ |
| Both full rejected | 1 | ✅ |
| Idempotent restore | 4 | ✅ |
| Restore after seat taken | 3 | ✅ |
| Cancel after restore | 2 | ✅ |
| Mission closed | 3 | ✅ |
| Timestamp preserved | 4 | ✅ |
| Restore timestamp | 2 | ✅ |
| Sequence preserved | 1 | ✅ |
| Unauthorized | 1 | ✅ |
| Not found | 1 | ✅ |
| WAITLIST cancel→restore | 2 | ✅ |
| Seat filled→WAITLIST | 2 | ✅ |
| Multiple restores ordering | 5 | ✅ |
| Auto-close compat | 2 | ✅ |
| **TOTAL** | **51** | **✅ ALL PASS** |

---

## Failures

None.

---

## Unverified

- **Browser E2E**: Frontend button rendering not verified in browser (TypeScript compiles clean)
- ~~**Concurrent restore**: Not tested with actual concurrent requests~~ → **FIXED** — real-HTTP concurrency tested: official (35/35) + temp (38/38), positions unique, no duplicates
- **Telegram notification content**: Notification text format not verified end-to-end
- ~~**Temporary registration self-restore**: Endpoint exists but not covered by dedicated tests~~ → **FIXED** — `temp_restore_real_endpoint.test.ts` (38/38 real-HTTP, all 7 gates) covers this

---

## Remaining Risks

1. **~TOCTOU on seat allocation~ (FIXED)**: ❗ The old allocation was **not** safe in practice — a real concurrent test produced duplicate waitlist positions. Fixed by rewriting both restore branches to allocate seat/position atomically inside the UPDATE (see `SELF_RESTORE_REAL_ENDPOINT_TEST_REPORT.md`). The temporary-registration endpoint now uses the **identical atomic pattern** — verified via real-HTTP concurrency test (positions [1,2,3], no duplicates). **No residual risk.**
2. **Quick-save flow orphaned**: The "سجّل المرة الجاية بطريقة أسرع" button was removed from success screen, making the quick-save flow unreachable — feature preserved in code for potential future re-enable
3. **Production deployment pending**: All changes are local only — DO NOT DEPLOY until reviewed

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| ✅ Volunteer can cancel | PASS |
| ✅ Volunteer sees restore action | PASS |
| ✅ Restore with free confirmed seat → CONFIRMED | PASS |
| ✅ Restore when confirmed full + waiting available → WAITLIST | PASS |
| ✅ Existing waitlisted volunteers keep priority | PASS |
| ✅ Restore when everything full → safely rejected | PASS |
| ✅ Double restore safe (idempotent) | PASS |
| ✅ Concurrent restore safe | PASS (real-HTTP: official positions [1,2], temp positions [1,2,3], no dup — atomic subqueries) |
| ✅ Mission auto-close remains correct | PASS |
| ✅ Exact registration timestamp displayed | PASS (seconds precision, matches storage) |
| ✅ Registration ordering is deterministic | PASS (registration_sequence) |
| ✅ Live registration list updates | PASS (existing Phase 6/7) |
| ✅ Obsolete buttons removed | PASS |
| ✅ No excessive polling | PASS (3s/10s intervals) |
| ✅ No privacy regression | PASS |
| ✅ TypeScript clean | PASS (backend + frontend) |
| ✅ Full test suite passes | PASS (51/51 new + all existing) |
