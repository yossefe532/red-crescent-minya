# SELF-RESTORE REAL ENDPOINT TEST REPORT

**Date:** 2026-09-14
**Scope:** Fix + verify the OFFICIAL self-restore endpoint via real HTTP (not inline logic).
**Deployment:** ⛔ NOT DEPLOYED — verification complete, deploy blocked pending sign-off.

---

## ROOT CAUSE

The official self-restore endpoint (`POST /registrations/:regId/self-restore` in `backend/src/routes/self-cancel.ts`)
selected the mission **without** the `waiting_list` column:

```sql
-- BEFORE (buggy)
SELECT id, status, capacity FROM missions WHERE id = ?
```

Then it computed waitlist capacity from the payload:

```ts
const waitingListCapacity = (m as any).waiting_list || 0;
```

Because `waiting_list` was never selected, `m.waiting_list` was always `undefined` → `waitingListCapacity` was **always 0**.
That made the guard `waitingListCapacity === 0 || totalWaitlistCount >= waitingListCapacity` **always true**, so *every*
legitimate restore with no free confirmed seat — but with open waitlist space — was **rejected** with
"المقاعد المؤكدة وقائمة الانتظار ممتلئتان حاليًا" (both full).

> The inline test helper always included `waiting_list` in its copy of the logic, so the 51-test suite passed while the
> real endpoint was broken. This is the classic "tests prove a copy, not the deployed route" trap.

---

## FIX

1. **SELECT the authoritative schema field** — read the actual column name from the DB migration (`waiting_list`):
   ```sql
   SELECT id, status, capacity, waiting_list FROM missions WHERE id = ?
   ```
   The schema (migrations) confirms the column `waiting_list`, so the source of truth is verified.

2. **Atomic seat/position allocation** — the original code used TOCTOU-prone read-then-write:
   - Read `MAX(waitlist_position)` in JS → write `maxPos + 1` separately.
   - Read used seats in JS → pick lowest free seat separately.
   Two concurrent restores could allocate the **same** waitlist position or **same** seat.
   Both branches were rewritten so the allocation happens **inside the UPDATE** (scalar subquery over BOTH
   `registrations` and `temporary_registrations`), serialized by SQLite's write lock:
   - CONFIRMED: recursive-CTE `nums` computes the lowest free seat among both tables atomically.
   - WAITLIST: subquery computes `MAX(position)+1` across both tables atomically.

This also removed the now-unused `maxWaitlistPos` variable. `npx tsc --noEmit` is clean.

**Scope note:** the critical-fix instruction targeted the OFFICIAL endpoint; the temporary-registration endpoint retains
the older non-atomic JS allocation pattern. It is functionally correct in serial runs but has the same theoretical TOCTOU
under true concurrency. See **Risk** below — a follow-up fix is recommended.

---

## OFFICIAL ENDPOINT TEST (real HTTP)

New test: **`backend/tests/self_restore_real_endpoint.test.ts`** — **35/35 PASS ✅**

Instead of an inline copy of the logic, the test:
1. Builds a real Hono app mounting the **actual** `selfCancelRoutes`.
2. Calls the real route over HTTP via `app.request()` with real `DB` bindings.
3. Sets the `ownership_token` cookie header exactly as the browser would.
4. Asserts on the **HTTP status + JSON response**, then independently reads the DB to confirm state.

`RESULTS: 35/35 PASS — ALL TESTS PASSED`

| # | Scenario | Verdict | Detail |
|---|----------|---------|--------|
| T1 | WAITLIST restore, room available | **PASS** | capacity=2, confirmed=2, waiting=3, existing waitlist=1 → HTTP 200, status=WAITLIST, position=2; existing user stays position 1 |
| T2 | WAITLIST restore, waitlist full | **PASS** | capacity=2, confirmed=2, waiting=3, existing waitlist=3 → rejected; no duplicate, no position 4, no counter corruption |
| T3 | CONFIRMED restore, seat available | **PASS** | HTTP 200, status=CONFIRMED, valid seat assigned |
| T4 | Mission CLOSED | **PASS** | restore rejected per business rules |
| T5 | Unauthorized (wrong token) | **PASS** | denied |
| T6 | Double restore | **PASS** | exactly one logical restore; second is idempotent |
| T7 | Concurrent restore | **PASS** | two concurrent restores → unique waitlist positions (1 and 2), exactly 2 positions, no seat/position duplicates, no counter corruption |

---

## REGRESSION

| Suite | Result |
|-------|--------|
| `npx tsc --noEmit` | ✅ clean |
| self-restore real endpoint test | ✅ 35/35 |
| phase5 cancel/restore | ✅ 42/42 (EXIT 0) |
| phase6 live/realtime | ✅ 24/24 (EXIT 0) |
| phase7 live UX | ✅ 59/59 |
| phase8 telegram sync | ✅ PASS all (EXIT 0) |
| registration_restore_e2e (inline helper) | ✅ 51/51 (EXIT 0) |
| telegram phase1 e2e | ✅ 44/44 |
| telegram phase2 e2e | ✅ 18/18 |
| telegram phase3 e2e | ✅ 28/28 (EXIT 0) |

**No regressions.** Existing registration, waiting-list, cancel/restore, live-realtime, and Telegram suites all green.

---

## AUTHORIZATION

- Missing token → **401** (no Cookie header sent).
- Wrong/forged token → **403**.
- Cross-user restore attempt (different `ownership_token` on the registration) → denied.
- Verified end-to-end through the real route + middleware.

---

## CONCURRENCY

Concurrent restores now allocate unique positions/seats atomically inside the UPDATE (SQLite writer serialization).
Test T7 proves: two concurrent WAITLIST restores → positions `1, 2` (unique), confirmed count unchanged at 2,
no overflow, no counter corruption.

**Residual risk (temporary-registration endpoint):** `POST /temporary-registrations/:regId/self-restore` still uses the old
read-then-write JS allocation. In serial tests it is correct, but under true concurrent writes on the same mission it has the
same theoretical duplicate-position/seat race. Recommended follow-up: apply the same atomic subquery pattern there.

**Residual risk (count check vs. allocation):** the capacity guards (`totalConfirmed < m.capacity`, `totalWaitlistCount >=
waitingListCapacity`) are read before the atomic UPDATE. Under extreme concurrency two writers could each pass the guard
before either writes; the atomic seat/reverse subquery prevents duplicate seats/positions, but a **count overflow** (e.g.
confirmed exceeding capacity by 1 in a pathological race) is theoretically possible until the count guards are also made
atomic. Low likelihood given single-worker Cloudflare write serialization; flagged for review.

---

## UNVERIFIED

- True multi-instance / multi-region D1 write contention (local SQLite test only).
- Live-region production soak of the concurrent endpoints under real load.

## STATUS
✅ **Root cause** — official endpoint missing `waiting_list` from the SELECT.
✅ **Fix** — authoritative field selected; atomic allocation (TOCTOU) in both restore branches.
✅ **Real-endpoint test** — 35/35 PASS via actual HTTP route.
✅ **Regression** — full suite green, `tsc` clean.
⚠️ **Risk** — temp endpoint + count-guard atomicity flagged (non-blocking, recommended follow-up).
⛔ **Not deployed** — per instruction.