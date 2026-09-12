# 📐 TELEGRAM_ARCHITECTURE.md
## Telegram Admin Bot Architecture — Red Crescent Minya

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    RED CRESCENT MINYA SYSTEM                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌──────────┐     ┌─────────────────┐     ┌─────────────┐    │
│   │ Telegram │────▶│  Cloudflare     │────▶│   D1 DB     │    │
│   │   Bot    │     │  Worker (Hono)  │     │  (SQLite)   │    │
│   └──────────┘     └─────────────────┘     └─────────────┘    │
│        ▲                   │                       ▲           │
│        │                   ▼                       │           │
│        │            ┌─────────────┐               │           │
│        └────────────│  Services   │───────────────┘           │
│                     │  (Mission,  │                             │
│                     │   Admin,    │                             │
│                     │   Audit)    │                             │
│                     └─────────────┘                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Single Source of Truth**: الـ Database واحد، والـ Services هي الطبقة الوحيدة اللي بتمس البيانات. Telegram Bot مجرد **Interface** فوق الـ services الموجودة.

---

## 2. File Structure

```
backend/src/
├── routes/
│   └── telegram.ts              ← Thin webhook router (158 lines)
├── telegram/
│   ├── bot.ts                   ← Core: tgSend, auth, session, escapeHtml
│   ├── types.ts                 ← WizardState, ParsedIntent, SessionRow
│   ├── keyboards.ts             ← All InlineKeyboard builders
│   ├── formatters.ts            ← Message formatting, dates, status labels
│   ├── intent.ts                ← AI + rule-based intent parser (Egyptian Arabic)
│   ├── callbacks.ts             ← Central callback_query dispatcher
│   ├── wizard.ts                ← Wizard state machine
│   └── commands/
│       ├── start.ts             ← /start, /help, /cancel
│       ├── missions.ts          ← list, detail, stats, link, whatsapp, export
│       ├── create.ts            ← 7-step create mission wizard
│       ├── edit.ts              ← edit mission fields
│       ├── toggle.ts            ← open/close registration
│       ├── delete.ts            ← delete with confirmation
│       ├── registrants.ts       ← view, volunteer detail, audio, move
│       └── cancel-reg.ts        ← cancel registration wizard
├── services/
│   ├── mission.service.ts       ← CRUD + availability + auto-close logic
│   ├── admin.service.ts         ← auth, create admin
│   └── audit.service.ts         ← audit logging
├── middleware/auth.ts           ← Session auth (Cookie + X-Auth-Token)
├── utils/id.ts                  ← UUID, codes, audio keys
├── utils/crypto.ts              ← password hash/verify
├── utils/response.ts            ← standard success/error responses
├── validation/admin.schema.ts   ← Zod schemas
└── env.ts                       ← Env interface (DB, AI, TELEGRAM_BOT_TOKEN, ADMIN_CHAT_IDS)
```

---

## 3. Data Flow

### Webhook Request Flow
```
Telegram Update (POST /telegram)
         │
         ▼
   ┌─────────┐
   │ Hono    │  ← telegramRoutes.post('/')
   │ Router  │
   └────┬────┘
        │
        ├──▶ callback_query ──▶ handleCallbackQuery(token, chatId, db, cb)
        │                              │
        │                              ├── nav:*  → navigation handlers
        │                              ├── m:*   → mission actions
        │                              ├── v:*   → volunteer actions
        │                              ├── wiz:*  → wizard callbacks
        │                              ├── confirm:* → confirmations
        │                              ├── edit:* → edit field picker
        │                              ├── delete:* → delete picker
        │                              ├── cancelreg:* → cancel wizard
        │                              └── notify:* → notification toggle
        │
        └──▶ message.text ──▶ Commands (/start, /help, /cancel)
                                 │
                                 ├──▶ Wizard check (handleWizardMessage)
                                 │       └──▶ state != idle → wizard handler
                                 │
                                 └──▶ Intent parsing (parseIntent)
                                         ├── create_mission → startCreateWizard
                                         ├── list_missions → handleListMissions
                                         ├── stats → handleStats
                                         ├── view_registrants → handleRegistrants
                                         ├── cancel_registration → startCancelWizard
                                         ├── delete_mission → startDeleteWizard
                                         ├── close_mission/open_mission → handleToggleRegistration
                                         └── default → help menu
```

### Service Layer (Single Source of Truth)
```
Command Handler
       │
       ▼
┌──────────────────┐
│  Mission Service │  ← createMission, getMissionById, updateMission, deleteMission,
│  Admin Service   │     getMissionAvailability, listMissions
│  Audit Service   │  ← logAudit
└────────┬─────────┘
         │
         ▼
    D1 Database
```

---

## 4. Commands Reference

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Welcome + main menu | `/start` |
| `/help` | Full command list | `/help` |
| `/cancel` | Cancel current wizard | `/cancel` |

### Mission Management (via buttons or natural language)
| Action | Natural Language | Callback |
|--------|------------------|----------|
| List all missions | "شوف المهمات" / "المهمات" | `nav:missions` |
| List active only | "المهمات النشطة" | `nav:missions:active` |
| Create mission | "اعمل مهمة" / "مهمة جديدة" | `nav:create` → wizard |
| Mission detail | — | `m:detail:<id>` |
| Open registration | "افتح مهمة MNY-123" | `m:open:<id>` |
| Close registration | "اقفل مهمة MNY-123" | `m:close:<id>` |
| Get link | "رابط MNY-123" | `m:link:<id>` |
| WhatsApp message | — | `m:whatsapp:<id>` |
| Export CSV | "تصدير MNY-123" | `m:export:<id>` |
| Delete mission | "امسح مهمة MNY-123" | `m:delete:<id>` → confirm |
| Edit mission | "عدّل مهمة MNY-123" | `m:edit:<id>` → field picker |

### Registrants & Waitlist
| Action | Natural Language | Callback |
|--------|------------------|----------|
| View registrants | "المسجلين في MNY-123" | `m:regs:<id>` |
| View waitlist | "الانتظار في MNY-123" | `m:wait:<id>` |
| Volunteer detail | — | `v:detail:<regId>` |
| Play audio | — | `v:audio:<regId>` |
| Move status | — | `v:move:<regId>:CONFIRMED\|WAITLIST` |
| Cancel registration | "شيل متطوع 123 من MNY-123" | `v:cancel:<regId>` |

### System
| Action | Natural Language | Callback |
|--------|------------------|----------|
| Statistics | "إحصائيات" | `nav:stats` |
| Bot status | "حالة البوت" | `nav:health` |
| Notifications | "الإشعارات" | `nav:notifications` → `notify:on/off` |

---

## 5. Callback Structure

```
Prefix:SubPrefix:ID:Params

nav:home | nav:missions | nav:missions:active | nav:create | nav:stats | nav:help | nav:notifications | nav:health

m:detail:<missionId> | m:regs:<missionId> | m:wait:<missionId> | m:open:<missionId> | m:close:<missionId> | m:link:<missionId> | m:whatsapp:<missionId> | m:export:<missionId> | m:edit:<missionId> | m:delete:<missionId>

v:detail:<regId> | v:audio:<regId> | v:move:<regId>:CONFIRMED|WAITLIST | v:cancel:<regId>

wiz:skip:<field> | wiz:cancel | wiz:confirm:create | wiz:restart

confirm:delete:<missionId> | confirm:cancelreg:<regId>

edit:field:<missionId>:<fieldName>

delete:pick:<missionId>

cancelreg:mission:<missionId> | cancelreg:vol:<regId> | cancelreg:back

notify:on | notify:off

noop
```

---

## 6. Wizard System

### Create Mission Wizard (7 Steps)
```
create_title        → "اكتب اسم المهمة" (min 3 chars)
    ↓
create_description  → "اكتب الوصف" (optional, skip button)
    ↓
create_location     → "اكتب المقر" (optional, skip button)
    ↓
create_start        → "تاريخ ووقت البداية" (ISO or relative, skip)
    ↓
create_end          → "تاريخ ووقت النهاية" (ISO or relative, skip)
    ↓
create_capacity     → "كم متطوع مطلوب؟" (positive integer, required)
    ↓
create_waitlist     → "كم في قائمة الانتظار؟" (default 0, skip)
    ↓
create_confirm      → Summary + [✅ إنشاء] [✏️ تعديل] [❌ إلغاء]
```

### Cancel Registration Wizard
```
cancelreg_select_mission → Pick mission (buttons or text hint)
    ↓
cancelreg_select_volunteer → Pick volunteer from mission
    ↓
cancelreg_confirm → Confirm cancel → execute (with waitlist promotion)
```

### Edit Mission Wizard
```
edit:field:<id>:<field> → Sets edit_value state
    ↓
edit_value (text input) → handleEditValue → updateMission service
```

---

## 7. Service Integration

### Mission Service (المصدر الوحيد للمنطق)
```typescript
// All mission operations go through these functions
createMission(db, data)           // INSERT + defaults
getMissionById(db, id)            // SELECT by UUID
getMissionByPublicCode(db, code)  // SELECT by MNY-XXX
listMissions(db, options)         // Paginated + status filter
updateMission(db, id, data)       // Dynamic UPDATE + updated_at
deleteMission(db, id)             // DELETE registrations + audit_logs + mission
getMissionAvailability(db, id)    // counts + auto-close logic
```

### Admin Service
```typescript
createAdminUser(db, { username, password, display_name })
authenticateAdmin(db, username, password) → { admin_id, username, display_name }
```

### Audit Service
```typescript
logAudit(db, { actorId, actorType, action, entityType, entityId, metadata })
```

**ممنوع**: أي `db.prepare()` مباشرة في command files. الكل عبر الـ services.

---

## 8. Permission Model

- **First-contact mode**: لو `ADMIN_CHAT_IDS` مش مت잡ط، أي حد يقدر يستخدم البوت
- **Restricted mode**: `ADMIN_CHAT_IDS` = comma-separated chat IDs → بس دول المسموحين
- **Middleware**: `adminAuth` في API routes، `isAuthorizedChat` في Telegram layer
- **Session**: مخزنة في `admin_sessions` table مع expiry 24 ساعة

---

## 9. Error Handling

| Layer | Strategy |
|-------|----------|
| Telegram API calls | Try/catch → log error → user-friendly message |
| Service calls | Try/catch → rethrow with context → Telegram shows error |
| Database | Try/catch → log → return standard error response |
| Webhook | Always return `{ ok: true }` to Telegram (200 OK) to prevent retries |

---

## 10. Registration Flow (Website → DB → Telegram Notification)

```
Volunteer (Website)
      │
      ▼
POST /api/register (registration.ts)
      │
      ├── Validate audio (mandatory, 500 bytes - 5MB)
      ├── Check mission OPEN + registration window
      ├── Idempotency (request_id)
      ├── Lookup/create volunteer
      ├── Atomic seat allocation:
      │     ├── Available seats → CONFIRMED + seat_number
      │     ├── Waitlist space → WAITLIST + waitlist_position
      │     └── Full + no waitlist → REJECTED + auto-close mission
      ├── Save registration + audio (R2 → D1 base64 fallback)
      ├── Audit log (volunteer actor)
      │
      ▼
Fire-and-forget: sendTelegramRegistrationNotification()
      │
      ├── Format message (name, member_id, mission, status, seat/waitlist)
      ├── Build InlineKeyboard (🎙️ استمع للتسجيل)
      ├── Send text to all ADMIN_CHAT_IDS
      └── Send voice if audio available
```

---

## 11. Waiting List Flow

```
New registration when capacity full
      │
      ├── waiting_list > 0 → WAITLIST + position = waitlist_count + 1
      ├── waiting_list = 0 → REJECTED + auto-close mission
      │
      └── On CANCEL of CONFIRMED:
            │
            ├── Find first WAITLIST by position ASC
            ├── Promote → CONFIRMED + freed seat_number
            ├── Decrement waitlist_position for all after promoted
            └── Audit log
```

---

## 12. Audio/Recording Delivery

### Storage
- **Primary**: R2 (`AUDIO_BUCKET`) — `missions/{code}/registrations/{id}.webm`
- **Fallback**: D1 `audio_confirmations.audio_data` (base64 text)

### Telegram Delivery
```typescript
// callbacks.ts → handleVolunteerAudio
1. Fetch audio_data from D1
2. Base64 decode → Uint8Array
3. tgSendVoice(token, chatId, bytes, mime, caption, duration)
4. On failure → user message with admin panel link
```

---

## 13. Notification System

### Real-time Registration Notifications
- **Trigger**: `/api/register` success (CONFIRMED or WAITLIST)
- **Payload**: volunteer name, member_id, mission title/code, status, seat/waitlist, audio
- **Delivery**: Fire-and-forget async (لا يمنع response للـ volunteer)
- **Retry**: لا يوجد retry تلقائي (batching manual لو محتاج)

### Admin Toggle
- `settings` table: `notifications_enabled = '1' | '0'`
- `notify:on/off` callback → upsert setting
- `handleNotify` reads setting before sending

---

## 14. AI Intent Parsing

### Cloudflare Workers AI (Llama 3.1 8B)
```typescript
parseIntent(text, ai) → {
  intent: "create_mission" | "list_missions" | ... | "unknown",
  confidence: 0.0-1.0,
  extracted: { title, location, capacity, missionCode, memberNumber, missionHint }
}
```

### Fallback: Rule-based (Egyptian Arabic)
- Regex patterns for: إنشاء، شوف، إحصائيات، فتح/قفل، امسح، شيل، مسجلين، انتظار، رابط، تصدير، عدّل
- Extracts MNY-XXX codes, member numbers (4+ digits), capacity keywords

---

## 15. Testing Plan

### Unit Tests (per command file)
- [ ] `start.ts` — /start clears session, sends help
- [ ] `missions.ts` — list/detail/stats/link/export return correct format
- [ ] `create.ts` — wizard steps advance correctly, validation works
- [ ] `toggle.ts` — open/close updates mission via service
- [ ] `delete.ts` — picker → confirm → delete via service
- [ ] `registrants.ts` — detail/audio/move via service
- [ ] `cancel-reg.ts` — wizard → cancel via service + promotion

### Integration Tests
- [ ] Full create mission flow via Telegram
- [ ] Registration notification fires on volunteer register
- [ ] Audio plays in Telegram
- [ ] Waitlist promotion on cancel
- [ ] Mission auto-close when full

### End-to-End
```
Admin (Telegram)
    ↓ Create mission (wizard)
    ↓ Open registration
Volunteer (Website)
    ↓ Register + voice
    ↓ Success
Admin (Telegram)
    ↓ Notification received + voice plays
    ↓ View registrants
    ↓ Move/Cancel volunteer
    ↓ Export CSV
```

---

## 16. Deployment Checklist

- [ ] Create bot via @BotFather → save token
- [ ] `wrangler secret put TELEGRAM_BOT_TOKEN`
- [ ] `wrangler secret put ADMIN_CHAT_IDS` (comma-separated)
- [ ] `wrangler d1 execute red-crescent-minya --file=./migrations/0001_init.sql --remote`
- [ ] `wrangler deploy --env production`
- [ ] Set webhook: `POST https://<worker>/telegram/setWebhook?url=https://<worker>/telegram`
- [ ] Test `/start` in Telegram
- [ ] Test full flow with real volunteer

---

*Generated: 2026-09-12*
*Version: 3.0 (Complete Rebuild)*