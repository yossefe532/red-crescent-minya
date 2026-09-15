# SELF-RESTORE FINAL SECURITY REPORT

**Date:** 2026-09-14
**Scope:** Security + correctness audit of the self-restore feature (official + temporary endpoints, real HTTP).
**Verdict convention:** `PASS` / `FAIL` / `UNVERIFIED`
**Deployment:** ⛔ **NOT DEPLOYED** — audit must pass review before any production deploy.

---

## SECTION 1 — AUDIT BOTH RESTORE ENDPOINTS (auth, ownership, state, capacity)

### 1a. Official — `POST /registrations/:regId/self-restore`
| Check | Verdict | Detail |
|-------|---------|--------|
| Auth (token required) | **PASS** | `getOwnershipToken(c)`; missing → 401 |
| Ownership (token matches reg) | **PASS** | `r.ownership_token !== ownershipToken` → 403 |
| State guard (only CANCELLED restores) | **PASS** | non-CANCELLED returns current state idempotently; only CANCELLED proceeds |
| Mission exists + not closed | **PASS** | not-found → 404; CLOSED/CANCELLED → 409 conflict |
| Capacity checked (confirmed) | **PASS** | `totalConfirmed < m.capacity` |
| Capacity checked (waitlist) | **PASS** | `waitingListCapacity = m.waiting_list` (authoritative field — **this was the fixed bug**) |
| Both-full rejection | **PASS** | waitlist full → 409; no oversubscription |
| Idempotency | **PASS** | double restore → one logical restore |
| Seat/position atomicity | **PASS** | both branches allocate inside UPDATE (TOCTOU fixed) |

### 1b. Temporary — `POST /temporary-registrations/:regId/self-restore`
| Check | Verdict | Detail |
|-------|---------|--------|
| Auth (token required) | **PASS** | missing → 401 |
| Ownership | **PASS** | token mismatch → 403 |
| State guard | **PASS** | only CANCELLED restores |
| Mission exists + not closed | **PASS** | 404 / 409 |
| Capacity (confirmed) | **PASS** | correct SELECT & guard |
| Capacity (waitlist) | **PASS** | `waiting_list` selected correctly (`m.waiting_list`) |
| Both-full rejection | **PASS** | 409 |
| Seat/position atomicity | **PASS** | atomic subquery/CTE inside UPDATE (TOCTOU fixed — same pattern as official); verified 38/38 real-HTTP tests incl. concurrency (positions 1,2,3, no dup) |

> **Decision (Section 5):** temporary endpoint is **PRODUCTION** (temp registrations are real flows, not test-only). It **now PASSES the atomicity gate** — the official endpoint's atomic subquery/CTE allocation was ported in and verified via real-HTTP concurrency test (38/38). See updated Section 4/5/7.

---

## SECTION 2 — OWNERSHIP TEST (cross-user denial, invalid token denial)
| Case | Verdict | Detail |
|------|---------|--------|
| Restore with correct device token | **PASS** | 200, state restored |
| Restore with another device's token (cross-user) | **PASS** | 403 forbidden — verified via real HTTP test |
| Restore with forged/unknown token | **PASS** | 403 forbidden |
| Restore with NO token | **PASS** | 401 unauthorized |

Covered on the official endpoint via real HTTP (`self_restore_real_endpoint.test.ts`). ✅

---

## SECTION 3 — STATE TEST (only CANCELLED can restore)
| Case | Verdict | Detail |
|------|---------|--------|
| CANCELLED → restore | **PASS** | proceeds |
| CONFIRMED → restore (idempotent) | **PASS** | returns current CONFIRMED state, no duplicate |
| WAITLIST → restore (idempotent) | **PASS** | returns current WAITLIST state, no duplicate |
| Mission CLOSED → restore | **PASS** | 409 rejected per business rules (T4) |
| Both full → restore | **PASS** | 409 safely rejected, no duplicate/counter corruption (T2) |

Tested via real HTTP. ✅

---

## SECTION 4 — CONCURRENCY TEST (no duplicate seats/positions)
| Check | Verdict | Detail |
|-------|---------|--------|
| Duplicate waitlist positions under concurrent restore | **PASS** | BOTH endpoints: official positions unique (1,2); temp positions unique (1,2,3) — real-HTTP concurrency, no dup |
| Duplicate seats under concurrent CONFIRMED restore | **PASS** | BOTH endpoints: atomic CTE seat allocation, no dup |
| Counter corruption | **PASS** | confirmed count unchanged at 2, waitlist count = 2 (no overflow), no corruption |
| Full-waitlist overflow race | **PASS** | capacity guard + atomic subquery; T2 proves no position 4 |

> History: the ORIGINAL official endpoint produced duplicate waitlist positions under concurrency (1,1) — the audit's real-HTTP test caught this, and the atomic-update fix resolved it. The **temporary** endpoint had the same latent race; it has **now been fixed with the identical atomic pattern** and verified (positions 1,2,3, no dup).

---

## SECTION 5 — TEMPORARY ENDPOINT DECISION
> **Verdict: PASS (keep — PRODUCTION, atomicity now resolved).**
- Temporary registrations (`temporary_registrations` table) are an active feature of the registration flow (quick-save before permanent confirmation). Self-restore for them is a **production capability**, NOT a test-only path.
- Removing it would break the restore flow for volunteers whose cancellation happened on a temporary (pre-confirmation) record.
- It shares the correct auth/ownership/state/capacity logic with the official endpoint and passes functional tests.
- **Atomicity: RESOLVED.** The official endpoint's atomic seat/position allocation has been ported into the temp endpoint with identical patterns (recursive CTE for seat allocation; scalar subquery for waitlist position). Verified via real-HTTP concurrency test (38/38, positions [1,2,3], no duplicates).

---

## SECTION 6 — TIMESTAMP CHECK
| Check | Verdict | Detail |
|-------|---------|--------|
| Original `created_at` preserved on restore | **PASS** | restore only updates `status/seat/waitlist_position/original_status/restored_at`; `created_at` untouched |
| `registration_sequence` untouched (order preserved) | **PASS** | sequence key never modified by restore |
| `restored_at` recorded | **PASS** | set to `datetime('now')` on restore |
| Fair ordering of restores | **PASS** | self-restore joins WAITLIST at END; existing waitlisters keep position (T1: existing stays position 1) |
| Timestamp end-to-end (HTTP) | **PASS** | create_at & restored_at round-trip via real endpoint; seconds precision matches storage (`datetime('now')` UTC) |

---

## SECTION 7 — FINAL BUILD
| Check | Verdict | Detail |
|-------|---------|--------|
| Backend `npx tsc --noEmit` | **PASS** | 0 errors |
| Frontend `npx tsc --noEmit` | **PASS** | 0 errors |
| Self-restore real-endpoint test (official) | **PASS** | 35/35 |
| Temp-restore real-endpoint test (temp) | **PASS** | 38/38 incl. concurrency (positions 1,2,3, no dup) |
| Registration_restore_e2e (inline) | **PASS** | 51/51 |
| phase5 cancel/restore | **PASS** | 42/42 |
| phase6 live/realtime | **PASS** | 24/24 |
| phase7 live UX | **PASS** | 59/59 |
| phase8 telegram sync | **PASS** | exit 0 |
| telegram phase1 | **PASS** | 44/44 |
| telegram phase2 | **PASS** | 18/18 |
| telegram phase3 | **PASS** | exit 0 |
| No undocumented temporary endpoints in production code | **PASS** | both self-restore endpoints are documented public routes; no stray temp routes |

---

## SUMMARY
| Section | Verdict |
|---------|---------|
| 1. Audit both endpoints | **PASS** |
| 2. Ownership test | **PASS** |
| 3. State test | **PASS** |
| 4. Concurrency test | **PASS** (both official + temp — real-HTTP, no duplicates) |
| 5. Temporary endpoint decision | **PASS** — keep (production); atomicity RESOLVED |
| 6. Timestamp check | **PASS** |
| 7. Final build | **PASS** (all suites incl. temp_restore_real_endpoint 38/38) |

## BLOCKERS / REQUIRED BEFORE DEPLOY
1. ~~Official endpoint waiting_list + atomic fix~~: ✅ RESOLVED.
2. ~~Temporary endpoint atomicity~~: ✅ RESOLVED (same atomic patterns ported, 38/38 real-HTTP verified incl. concurrency).
3. Human review of this report + `SELF_RESTORE_REAL_ENDPOINT_TEST_REPORT.md`.

## ON-GOING-DEPLOY-STATUS
✅ **READY FOR DEPLOYMENT** — full security audit complete, both endpoints atomic, all 7 gates PASS. Awaiting human sign-off.