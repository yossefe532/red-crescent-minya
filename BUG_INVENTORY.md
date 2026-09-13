# BUG INVENTORY
**Date:** 2026-09-13 | **Mode:** READ-ONLY

## Confirmed Bugs
1. **BUG-001**: close_mission and open_mission intents route to startDeleteWizard instead of toggle handler. File: `telegram/intent.ts`, function: parseWithRules. Severity: HIGH.
2. **BUG-002**: No Reopen action for CLOSED missions. Anywhere in UI or Bot. Severity: HIGH.
3. **BUG-003**: Registration REJECTED status exists in logic but not in DB CHECK constraint (only PENDING|CONFIRMED|WAITLIST|CANCELLED allowed). Severity: MEDIUM.
4. **BUG-004**: handleToggleRegistration actorId hardcoded 'telegram'. File: `telegram/commands/toggle.ts`. Severity: LOW.
5. **BUG-005**: tgSend throws on error (no catch), tgEdit/tgAnswerCb silently swallow. Inconsistent error handling. File: `telegram/bot.ts`. Severity: MEDIUM.
6. **BUG-006**: Registration response sent BEFORE notification (fire-and-forget after return). If notification fails, user never knows. File: `routes/registration.ts` lines 586-611. Severity: LOW.

## Potential Bugs
1. **POTENTIAL-001**: Race condition on last seat — two concurrent registrations could both get CONFIRMED beyond capacity (no DB transaction/locking).
2. **POTENTIAL-002**: MNY codes are random 3-digit — collision possible (no retry on collision).
3. **POTENTIAL-003**: Audio stored as base64 in D1 exceeds practical limits; R2 fallback may silently fail.
4. **POTENTIAL-004**: No timeout on Telegram API calls — can hang indefinitely.
5. **POTENTIAL-005**: publicRegistrationRoutes and adminRoutes both mounted under /api — potential route ordering issues.
6. **POTENTIAL-006**: D1 blob migration (0003) adds BLOB column but D1 doesn't support real BLOBs — data stored as text corruption risk.
7. **POTENTIAL-007**: Frontend polls /status every 1s — can hammer backend with many concurrent users.
