# PRE-DEPLOYMENT VERIFICATION RESULTS

**Date:** 2026-09-13T09:13:22.397Z
**Total:** 72 | **Passed:** 65 | **Failed:** 7

| # | Test | Result | Detail |
|---|------|--------|--------|
| 1 | 8 migration files | ✅ PASS |  |
| 2 | 0001_init.sql valid SQLite | ✅ PASS |  |
| 3 | 0002_add_phone_and_quick_register.sql valid SQLite | ✅ PASS |  |
| 4 | 0003_audio_blob.sql valid SQLite | ✅ PASS |  |
| 5 | 0004_telegram_sessions.sql valid SQLite | ✅ PASS |  |
| 6 | 0005_waiting_list_and_notifications.sql valid SQLite | ✅ PASS |  |
| 7 | 0006_reopen.sql valid SQLite | ✅ PASS |  |
| 8 | 0007_notification_outbox.sql valid SQLite | ✅ PASS |  |
| 9 | 0008_registration_unique.sql valid SQLite | ✅ PASS |  |
| 10 | DB has tables | ✅ PASS | 15 tables |
| 11 | Table 'notification_events' | ✅ PASS |  |
| 12 | Table 'registrations' | ✅ PASS |  |
| 13 | Table 'admin_users' | ✅ PASS |  |
| 14 | Table 'admin_sessions' | ✅ PASS |  |
| 15 | Table 'missions' | ✅ PASS |  |
| 16 | Table 'volunteers' | ✅ PASS |  |
| 17 | notification_events.id | ✅ PASS |  |
| 18 | notification_events.event_type | ✅ PASS |  |
| 19 | notification_events.status | ✅ PASS |  |
| 20 | notification_events.attempts | ✅ PASS |  |
| 21 | notification_events.payload | ✅ PASS |  |
| 22 | notification_events.registration_id | ✅ PASS |  |
| 23 | notification_events.mission_id | ✅ PASS |  |
| 24 | notification_outbox.ts | ✅ PASS |  |
| 25 | notification_processor.ts | ✅ PASS |  |
| 26 | Admin login 200 | ✅ PASS | status=200 |
| 27 | Token received | ✅ PASS |  |
| 28 | 401 without auth | ✅ PASS |  |
| 29 | 200 with auth | ✅ PASS |  |
| 30 | Mission created | ✅ PASS | status=200 |
| 31 | Mission has ID | ✅ PASS |  |
| 32 | Mission has public_code | ✅ PASS | MNY-312 |
| 33 | Registration toggled ON | ✅ PASS | status=200 |
| 34 | Registration 200 | ✅ PASS | status=201 |
| 35 | Registration has data | ✅ PASS | id=undefined |
| 36 | Registration in DB | ✅ PASS | status=CONFIRMED |
| 37 | Notification events created | ❌ FAIL | count=0 |
| 38 | createNotificationEvent exists | ✅ PASS | lines 6, 465, 499 |
| 39 | Main return identified | ✅ PASS | line 575 |
| 40 | All notifications BEFORE return | ✅ PASS | calls at [6,465,499] < return at 575 |
| 41 | No legacy dead notification code | ✅ PASS | found 0 |
| 42 | requireAdmin imported | ✅ PASS |  |
| 43 | requireAdmin guard count >= 16 | ✅ PASS | found 18 |
| 44 | handleMission (close/open/reopen) guarded | ❌ FAIL |  |
| 45 | handleEdit (edit field) guarded | ✅ PASS |  |
| 46 | handleDelete (delete confirmation) guarded | ✅ PASS |  |
| 47 | handleDeletePick (delete:pick) guarded | ✅ PASS |  |
| 48 | handleMove (seat reallocation) guarded | ✅ PASS |  |
| 49 | handleCancel (volunteer cancel) guarded | ✅ PASS |  |
| 50 | handleNotify (notification settings) guarded | ❌ FAIL |  |
| 51 | handleConfirm (confirm:delete/cancelreg) guarded | ❌ FAIL |  |
| 52 | handleCancelReg (cancelreg picker) guarded | ❌ FAIL |  |
| 53 | handleWiz (wizard create) guarded | ❌ FAIL |  |
| 54 | handleViewRegistrants (regs) guarded | ✅ PASS |  |
| 55 | handleViewWaitlist (wait) guarded | ✅ PASS |  |
| 56 | handleExport (export) guarded | ✅ PASS |  |
| 57 | Public volunteer features accessible | ✅ PASS | m:detail, v:detail, v:audio — verified by code review |
| 58 | Registration checks telegram_notifications | ✅ PASS |  |
| 59 | Notification conditional | ✅ PASS | `SELECT id, public_code, title, status, capacity, waiting_list, telegram_notific |
| 60 | R2 [[r2_buckets]] | ✅ PASS |  |
| 61 | R2 AUDIO_BUCKET | ✅ PASS |  |
| 62 | D1 [[d1_databases]] | ✅ PASS |  |
| 63 | [triggers] cron | ✅ PASS |  |
| 64 | export scheduled function | ✅ PASS |  |
| 65 | processPendingNotifications in scheduled | ✅ PASS |  |
| 66 | Scheduled uses env.DB | ✅ PASS |  |
| 67 | Audio blob handling | ✅ PASS |  |
| 68 | Duplicate returns 409 | ✅ PASS | status=409 |
| 69 | 409 has meaningful error | ❌ FAIL | {"success":false,"error":{"code":"ALREADY_REGISTERED","message":"أنت مسجل بالفعل في هذه المهمة ومقعدك رقم 1.","registration_id":"MNY-312-REG-000001","status":"CONFIRMED"}} |
| 70 | No duplicate in DB | ✅ PASS | count=1 |
| 71 | UNIQUE constraint documented | ✅ PASS | 0001_init.sql UNIQUE(mission_id, volunteer_id) |
| 72 | TypeScript compilation | ✅ PASS | EXIT 0 |
