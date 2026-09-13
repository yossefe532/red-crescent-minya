# 🗺️ TELEGRAM RUNTIME MAP & AUDIT INVENTORY
*Branch: main | Environment: Local / Production | Generated: Phase 1/2 Audit*

## 1. Commands Registry

| COMMAND | HANDLER | REGISTERED? | REACHABLE? | AUTH REQUIRED? | BACKEND SERVICE | STATUS |
|---------|---------|-------------|------------|----------------|-----------------|--------|
| `/start` | `startCommandHandler` | ✅ Yes | ✅ Yes | ❌ No (Missing Admin vs Public differentiation) | `clearSession`, `mainMenuKeyboard` | ⚠️ Incomplete (Shows admin menu to non-admins) |
| `/help` | `helpCommandHandler` | ✅ Yes | ✅ Yes | ❌ No | Formatters | ✅ Working |
| `/cancel` | `cancelCommandHandler` | ✅ Yes | ✅ Yes | ❌ No | `clearSession` | ✅ Working |
| `/missions` | `handleMissionsList` | ❌ No (Fallback regex only) | ⚠️ Partial (Only via NLP fallback) | ✅ Yes | `listMissions`, `getMissionAvailability` | ⚠️ Missing explicit command route |
| `/create` | `startCreateWizard` | ❌ No (Fallback regex only) | ⚠️ Partial (Only via NLP fallback) | ✅ Yes | `createMission` | ⚠️ Missing explicit command route |
| `/registrants` | `handleMissionSelectForRegistrants` | ❌ No (Fallback regex only) | ⚠️ Partial (Only via NLP fallback) | ✅ Yes | `listMissions` | ⚠️ Missing explicit command route |
| `/stats` | `handleStats` | ❌ No (Fallback regex only) | ⚠️ Partial (Only via NLP fallback) | ✅ Yes | `getStats` | ⚠️ Missing explicit command route |
| `/notifications` | `handleNotificationSettings` | ❌ No | ❌ No | ✅ Yes | Settings | ❌ Missing explicit command route |
| `/health` | `handleHealth` | ❌ No | ❌ No | ✅ Yes | Health check | ❌ Missing explicit command route |

---

## 2. Callback Queries Registry

| CALLBACK PATTERN | HANDLER | REGISTERED? | REACHABLE? | AUTH REQUIRED? | ROOT CAUSE / STATUS |
|------------------|---------|-------------|------------|----------------|---------------------|
| `nav:home` | `startCommandHandler` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:missions` | `handleMissionsList` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:create` / `wiz:create:start` | `startCreateWizard` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:registrants` | `handleMissionSelectForRegistrants` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:stats` | `handleStats` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:health` | `handleHealth` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:notifications` | `handleNotificationSettings` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:help` | `helpCommandHandler` | ✅ Yes | ❌ BROKEN | ❌ No | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `nav:cancel` | `cancelCommandHandler` | ✅ Yes | ❌ BROKEN | ❌ No | ❌ Crashed by D1 `telegram_sessions.value` SQL error |
| `m:page:<filter>:<page>` | `handleMissionsList` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error + dedup session overwrite |
| `m:detail:<id>` | `handleMissionDetail` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:detail_pub:<id>` | `handleMissionDetail` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Routing mismatch with `missionPickerKeyboard` |
| `m:regs:<id>` | `handleMissionRegistrants` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:waitlist:<id>` | `handleMissionWaitlist` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:link:<id>` | `handleGetLink` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:close:<id>` | `handleCloseMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:reopen:<id>` | `handleReopenMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:edit:<id>` | `handleEditMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:delete:<id>` | `handleDeleteMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `m:toggle:<id>:<field>` | `handleToggleMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `v:detail:<regId>` | `handleRegistrantDetail` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ **Signature Bug**: `parts` passed as string instead of array |
| `v:audio:<regId>` | `handlePlayAudio` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ **Signature Bug**: `parts` passed as string instead of array |
| `v:promote:<regId>` | `handlePromote` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ **Signature Bug**: `parts` passed as string instead of array |
| `v:demote:<regId>` | `handleDemote` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ **Signature Bug**: `parts` passed as string instead of array |
| `v:cancel:<regId>` | `handleCancelRegistrant` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ **Signature Bug**: `parts` passed as string instead of array |
| `v:cancel_confirm:<regId>` | `handleCancelRegistrantConfirm` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ **Signature Bug**: `parts` passed as string instead of array |
| `wiz:create:skip:<field>` | `handleCreateSkip` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `wiz:create:confirm` | `executeCreateMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `wiz:create:cancel` | `cancelCreateWizard` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `confirm:delete:<id>` | `executeDeleteMission` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `confirm:cancel:<regId>` | `executeCancelRegistration` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `edit:field:<field>:<id>` | `startEditField` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |
| `notify:toggle:<type>` | `handleNotificationToggle` | ✅ Yes | ❌ BROKEN | ✅ Yes | ❌ Crashed by SQL error |

---

## 3. Key Findings & Root Causes

1. **Root Cause 1 (Critical P0 Crash)**: In `src/telegram/callbacks.ts`, anti-deduplication executes:
   `SELECT value FROM telegram_sessions WHERE chat_id = ? AND state = '_cb_dedup_'`
   The `telegram_sessions` table has NO `value` column (it has `chat_id, state, data, updated_at`). This throws an SQLite error on EVERY callback query. The catch block catches it and returns `❌ حدث خطأ غير متوقع. جرب /start`.
2. **Root Cause 2 (Session Corruption)**: Anti-deduplication writes `setSession(db, chatId, '_cb_dedup_', ...)` on every callback, overwriting in-flight session states (such as active wizards).
3. **Root Cause 3 (Volunteer Router Signature Bug)**: In `src/telegram/callbacks.ts`, `handleVolunteer` was called with `data` (a string) where it expected `parts: string[]`. `action = parts[0]` evaluated to character `'v'`, causing all `v:*` sub-actions (`detail`, `audio`, `promote`, `demote`, `cancel`) to never match.
4. **Root Cause 4 (Command Handling Gap)**: `src/routes/telegram.ts` only handled `/start`, `/help`, and `/cancel`. All other commands (`/missions`, `/create`, `/registrants`, `/stats`, `/notifications`, etc.) were unhandled or relegated to fragile NLP intent parsing. Command parsing also did not strip bot mention suffixes (e.g. `/start@botname`).
5. **Root Cause 5 (Missing Admin Differentiation in /start)**: `/start` did not check if the sender was an authorized admin (`isAuthorizedChat`), giving public users the admin keyboard while failing to give authorized admins a personalized admin shell.
6. **Root Cause 6 (Broken missionPickerKeyboard)**: Ignored prefix parameter, hardcoding invalid `m:detail_pub:${m.id}` callbacks.
