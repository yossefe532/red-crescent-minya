# 🔍 Telegram Bot Audit Report — Red Crescent Minya

## 📅 Date: 2026-09-12

---

## 1. النظام الحالي — ملخص كامل

### 1.1 Database Schema (D1/SQLite)

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `missions` | المهمات | id, public_code (MNY-XXX), title, description, location, start_at, end_at, capacity, waiting_list, telegram_notifications, status (DRAFT/OPEN/CLOSED/CANCELLED/COMPLETED), confirmation_phrase |
| `volunteers` | المتطوعين | id, member_id (unique), name, phone |
| `registrations` | التسجيلات | id, mission_id, volunteer_id, status (PENDING/CONFIRMED/WAITLIST/CANCELLED), seat_number, waitlist_position, registration_sequence, request_id |
| `audio_confirmations` | تسجيلات صوتية | id, registration_id, phrase, audio_key, duration_ms, mime_type, audio_data (base64) |
| `admin_users` | مستخدمي الأدمن | id, username, password_hash, display_name, is_active |
| `admin_sessions` | جلسات الأدمن | token, admin_id, username, expires_at |
| `audit_logs` | سجل عمليات | id, actor_id, actor_type, action, entity_type, entity_id, metadata |
| `registration_attempts` | محاولات تسجيل | id, mission_id, volunteer_id, member_id, name, status, audio_key, expires_at |
| `telegram_sessions` | حالة wizard البوت | chat_id, state, data (JSON), updated_at |
| `quick_profiles` | حفظ بيانات سريع | id, volunteer_id, member_id, name, phone |
| `temporary_registrations` | تسجيلات مؤقتة | id, mission_id, name, phone, status, seat_number, waitlist_position |

### 1.2 Backend Services

#### mission.service.ts
- `createMission(db, data)` — إنشاء مهمة + public_code + confirmation_phrase
- `getMissionById(db, id)` — جلب مهمة بالـ ID
- `getMissionByPublicCode(db, code)` — جلب مهمة بالـ public_code
- `listMissions(db, options)` — عرض المهمات مع pagination + status filter
- `updateMission(db, id, data)` — تحديث مهمة (fields مرنة)
- `deleteMission(db, id)` — حذف مهمة + كل التسجيلات المرتبطة
- `getMissionAvailability(db, id)` — أرقام التسجيل: confirmed, waitlist, available, auto-close logic

#### admin.service.ts
- `createAdminUser(db, data)` — إنشاء أدمن
- `authenticateAdmin(db, username, password)` — تسجيل دخول

#### audit.service.ts
- `logAudit(db, options)` — تسجيل عملية في audit_logs

### 1.3 Backend API Routes

#### Admin Routes (require adminAuth)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/login` | تسجيل الدخول |
| POST | `/api/admin/logout` | تسجيل الخروج |
| POST | `/api/admin/missions` | إنشاء مهمة |
| GET | `/api/admin/missions` | عرض المهمات (page, limit, status) |
| GET | `/api/admin/missions/:id` | تفاصيل مهمة + availability |
| PATCH | `/api/admin/missions/:id` | تحديث مهمة |
| POST | `/api/admin/missions/:id/toggle-registration` | فتح/قفل التسجيل |
| PATCH | `/api/admin/missions/:id/details` | تعديل تفاصيل |
| POST | `/api/admin/missions/:id/close` | إغلاق نهائي |
| DELETE | `/api/admin/missions/:id` | حذف مهمة |
| GET | `/api/admin/missions/:id/registrations` | المسجلين (+ temporary_registrations) |
| POST | `/api/admin/registrations/:regId/cancel` | إلغاء تسجيل + promote waitlist |
| POST | `/api/admin/missions/:id/cancel/:regId` | إلغاء تسجيل (مع mission ID) |
| GET | `/api/admin/missions/:id/export` | تصدير CSV |
| GET | `/api/admin/registrations/:regId/audio` | جلب تسجيل صوتي |

#### Public Routes (no auth)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/missions/:publicCode` | معلومات مهمة + أرقام |
| GET | `/api/missions/:publicCode/registrations-live` | المسجلين مباشر |
| GET | `/api/volunteers/by-member-id/:memberId` | بحث متطوع |

#### Registration Routes (no auth)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | تسجيل متطوع (مع صوت إلزامي) |
| GET | `/api/register/status/:id` | حالة تسجيل |

#### Quick Routes (no auth)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/quick-profile/save` | حفظ بيانات سريع |
| GET | `/api/quick-profile/lookup/:memberId` | بحث بيانات محفوظة |
| POST | `/api/register-temporary` | تسجيل مؤقت بدون عضوية |

### 1.4 Business Logic Rules

1. **Mission Statuses**: DRAFT → OPEN → CLOSED/CANCELLED/COMPLETED
2. **Registration Flow**: PENDING → CONFIRMED (if seats available) / WAITLIST (if full) / CANCELLED
3. **Auto-close**: المهمة تقفل تلقائياً لما الـ capacity + waiting_list يكتملوا
4. **Waitlist Promotion**: لما يتلغي تسجيل مؤكد، أول واحد في الانتظار يترقى تلقائياً
5. **Duplicate Prevention**: نفس المتطوع مش ممكن يتسجل مرتين في نفس المهمة (UNIQUE constraint)
6. **Audio Required**: التسجيل الصوتي إلزامي (≥500 bytes, ≤5MB)
7. **Phone Validation**: مصري فقط (01XXXXXXXXX)
8. **Idempotency**: request_id لمنع التسجيل المكرر

### 1.5 Environment Variables
- `DB` — D1 Database binding
- `AUDIO_BUCKET` — R2 Bucket (commented out in wrangler.toml — unavailable)
- `TELEGRAM_BOT_TOKEN` — via wrangler secret / .dev.vars
- `ADMIN_CHAT_IDS` — comma-separated admin Telegram chat IDs
- `AI` — Workers AI binding (for NLU)
- `FRONTEND_URL` — https://red-crescent-minya.pages.dev

---

## 2. Telegram Bot Audit — البوت القديم

### 2.1 الحجم والتعقيد
- **1619 سطر** في ملف واحد (`telegram.ts`)
- **ملف واحد ضخم** — مش modular

### 2.2 المشاكل الهيكلية الخطيرة

#### ❌ مشكلة #1: الـ Business Logic مكررة
البوت بيعمل DB queries مباشرة **بدل ما يستخدم الـ services** الموجودة:
- `createMission` — البوت عنده INSERT خاص به (سطر 506-514) بدل `mission.service.createMission()`
- `deleteMission` — البوت عنده DELETE خاص (سطر 857-859) بدل `mission.service.deleteMission()`
- `toggleRegistration` — البوت عامل UPDATE مباشر (سطر 890-892) بدل API
- `cancelRegistration` — البوت عامل UPDATE + promote مباشر (سطر 923-941) — منطق مختلف عن الـ admin route

#### ❌ مشكلة #2: Schema Mismatch
- البوت بيعمل INSERT في `missions` بـ `capacity = 10` default — الـ DB CHECK يقول `capacity > 0` بس الـ service defaults مختلفة
- البوت بيحط `waiting_list` في columns —  الـ migration الأصلي **ما عندوش** عمود `waiting_list` في `missions` table! (أضيف لاحقاً بدون migration)
- البوت بيحط `telegram_notifications` — نفس المشكلة

#### ❌ مشكلة #3: Dead/Inconsistent Handlers
- `findMissionByHint` في البوت بيدور على `id` أولاً (UUID from callback) — صح
- لكن `executeDelete` بيحذف بالترتيب: registrations → audio_confirmations → missions — بينما `mission.service.deleteMission()` بيحذف registrations → audit_logs → missions (ترتيب مختلف!)
- البوت بيحذف audio_confirmations مباشرة — الـ service **مش بيحذفها**

#### ❌ مشكلة #4: Wizard Flow ناقص
البوت القديم بيسأل:
1. Title
2. Location
3. Capacity
4. Confirm

**المفروض** (حسب الـ create mission schema):
1. Title ✅
2. Description ❌ (مش موجود)
3. Location ✅
4. start_at ❌ (البوت بيحط 7 أيام من now بدل السؤال)
5. end_at ❌ (بيحط 7 أيام من now)
6. Capacity ✅
7. waiting_list ❌ (البوت بيحط 0 بدل السؤال)
8. registration_open_at ❌
9. registration_close_at ❌
10. Confirm

#### ❌ مشكلة #5: Missing Features
البوت القديم **ما بيعملش**:
- تعديل مهمة (edit mission details)
- عرض تفاصيل مهمة كاملة
- تصدير CSV
- إحصائيات مهمة معينة (فقط إحصائيات عامة)
- عرض رابط تسجيل (مع copy)
- إدارة temporary_registrations
- عرض أرقام: المقاعد المتبقية، نسبة الامتلاء

#### ❌ مشكلة #6: Duplicate Code
- `parseWithRules` و `ParsedIntent` interface مكررين مرتين في الملف (سطر 241 + سطر 1024)
- `parseIntent` مكرر مرتين (سطر 162 + سطر 1125)

#### ❌ مشكلة #7: Missing Wizard Steps
الكود عنده wizard states لكن functions مش موجودة:
- `wizardCreateDescription` — referenced in handleWizardMessage (سطر 1310) but function not defined
- `wizardCreateStart` — referenced (سطر 1314) but not defined
- `wizardCreateEnd` — referenced (سطر 1318) but not defined
- `wizardCreateWaitlist` — referenced (سطر 1326) but not defined
- `showCreateSummary` — referenced (سطر 1268) but not defined
- `showMissions` — referenced but not in the file visible portion
- `showMissionDetail` — referenced but not in visible portion
- `getMissionByHint` — used as standalone (سطر 1469) but `findMissionByHint` is defined (سطر 350)

#### ❌ مشكلة #8: Import Issues
- `import { createMission } from '../services/mission.service'` — imported but never used (البوت عامل INSERT خاص)
- `import { InlineKeyboard } from 'grammy'` — requires `grammy` to be installed

### 2.3 الحاجات الصح في البوت القديم
- ✅ Telegram API Helpers (tgSend, tgEdit, tgAnswerCb, tgDeleteMessage) — صح ومتينة
- ✅ D1 Session Management (getSession, setSession, clearSession) — شغالة
- ✅ Authorization (isAuthorizedChat) — first-contact mode fallback
- ✅ HTML escaping (escapeHtml) — موجودة
- ✅ AI + Rule-based intent parsing — concept صح بس التنفيذ duplicated
- ✅ MainMenu keyboard — صحيحة
- ✅ Volunteer detail view — comprehensive
- ✅ Audio sending via sendVoice API — working

---

## 3. Architecture الجديدة

### 3.1 المبدأ الأساسي

```
Telegram Bot Layer (handlers, formatters, keyboards)
        ↓ calls
Existing Services (mission.service, admin.service, audit.service)
        ↓ queries
D1 Database (single source of truth)
```

**ممنوع**:
- DB queries مباشرة من الـ bot (إلا للـ telegram_sessions)
- Business logic مكررة
- INSERT/UPDATE/DELETE مباشر بدل الـ services

### 3.2 File Structure

```
backend/src/
├── routes/
│   └── telegram.ts              ← Main webhook handler (thin)
├── telegram/
│   ├── bot.ts                   ← Core: tgSend, tgEdit, auth, session
│   ├── types.ts                 ← WizardState, WizardData, ParsedIntent
│   ├── keyboards.ts             ← All InlineKeyboard builders
│   ├── formatters.ts            ← Message formatting (HTML, dates, status labels)
│   ├── intent.ts                ← AI + rule-based intent parser
│   ├── commands/
│   │   ├── start.ts             ← /start, /help, /cancel
│   │   ├── missions.ts          ← list, detail, stats, link
│   │   ├── create.ts            ← Create mission wizard (7 steps)
│   │   ├── edit.ts              ← Edit mission
│   │   ├── toggle.ts            ← Open/close registration
│   │   ├── delete.ts            ← Delete mission
│   │   ├── registrants.ts       ← View registrants, waitlist
│   │   ├── cancel-reg.ts        ← Cancel registration
│   │   ├── export.ts            ← CSV export
│   │   └── volunteer.ts         ← Volunteer detail, audio, move status
│   ├── callbacks.ts             ← Central callback_query dispatcher
│   └── wizard.ts                ← Wizard state machine
```

### 3.3 Create Mission Wizard — Complete Flow

```
Step 1: اسم المهمة (title) — required, min 3 chars
Step 2: الوصف (description) — optional, skip button
Step 3: المقر/العنوان (location) — optional, skip button
Step 4: تاريخ البداية (start_at) — required, date picker or text
Step 5: تاريخ النهاية (end_at) — required, date picker or text
Step 6: العدد الأساسي (capacity) — required, positive integer
Step 7: عدد قائمة الانتظار (waiting_list) — default 0, skip button
Step 8: ملخص + تأكيد

Summary message:
📋 ملخص المهمة الجديدة
━━━━━━━━━━━━━━━━━
📝 الاسم: [title]
📄 الوصف: [description or "—"]
📍 المقر: [location or "—"]
📅 البداية: [start_at formatted]
📅 النهاية: [end_at formatted]
👥 السعة: [capacity] متطوع
⏳ الانتظار: [waiting_list]
━━━━━━━━━━━━━━━━━

[✅ إنشاء المهمة] [✏️ تعديل] [❌ إلغاء]
```

### 3.4 Mission Detail View

```
📋 تفاصيل المهمة MNY-XXX
━━━━━━━━━━━━━━━━━
📝 الاسم: [title]
📄 الوصف: [description]
📍 المقر: [location]
📅 البداية: [start_at]
📅 النهاية: [end_at]
📊 الحالة: [status emoji + Arabic name]
👥 السعة: [confirmed]/[capacity] ([available] متاح)
⏳ الانتظار: [waitlist]/[waiting_list]
🔗 رابط التسجيل: https://red-crescent-minya.pages.dev/m/MNY-XXX
━━━━━━━━━━━━━━━━━

[🟢 فتح التسجيل] or [🔴 إغلاق] (based on status)
[👥 المسجلين] [⏳ قائمة الانتظار]
[✏️ تعديل] [📲 رسالة واتساب] [🔗 رابط]
[📊 إحصائيات] [📥 تصدير CSV]
[🗑️ حذف] [🔙 القائمة]
```

---

## 4. خطة التنفيذ

### Phase 1: Core Infrastructure
- [ ] إنشاء `telegram/` directory structure
- [ ] نقل bot.ts (tgSend, tgEdit, auth, session)
- [ ] نقل types.ts (WizardState, WizardData, ParsedIntent)
- [ ] نقل keyboards.ts
- [ ] نقل formatters.ts
- [ ] تحديث telegram.ts route (thin handler)

### Phase 2: Commands via Services
- [ ] commands/start.ts
- [ ] commands/missions.ts (list, detail, stats)
- [ ] commands/create.ts (7-step wizard via services)
- [ ] commands/toggle.ts (open/close via services)
- [ ] commands/delete.ts (via services)
- [ ] commands/registrants.ts (view registrants, waitlist)
- [ ] commands/cancel-reg.ts (cancel via services)
- [ ] commands/volunteer.ts (detail, audio, move)
- [ ] commands/export.ts (CSV export)
- [ ] commands/edit.ts (edit mission via services)

### Phase 3: Callbacks + Wizard
- [ ] callbacks.ts (central dispatcher)
- [ ] wizard.ts (state machine)
- [ ] intent.ts (unified AI + rules)

### Phase 4: Testing + Deploy
- [ ] Test all commands locally
- [ ] Set webhook
- [ ] Deploy to Cloudflare
- [ ] Verify all features

---

## 5. Migration Table Check

### Missing columns in migration (added later):
- `missions.waiting_list` — NOT in 0001_init.sql, used by services
- `missions.telegram_notifications` — NOT in 0001_init.sql, used by services
- `volunteers.phone` — NOT in 0001_init.sql, used by registration + quick routes
- `audio_confirmations.audio_data` — NOT in 0001_init.sql (base64 storage column)
- `quick_profiles` table — NOT in 0001_init.sql
- `temporary_registrations` table — NOT in 0001_init.sql

These were likely added via manual ALTER TABLE or a separate migration not tracked.
