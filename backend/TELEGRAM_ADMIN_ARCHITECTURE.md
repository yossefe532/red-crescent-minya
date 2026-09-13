# 🏛️ TELEGRAM ADMIN ARCHITECTURE & SPECIFICATION
*Branch: main | Environment: Local Verified / Production Ready | Phase: Phase 3 COMPLETE*

## 1. System Overview

The Telegram Admin Layer provides a comprehensive, state-aware control shell for administrators of the Egyptian Red Crescent (Minya Branch). It operates as a thin, secure UI client above the shared Backend Service Layer (`src/services/*`), maintaining strict domain integrity without competing sources of truth.

```
Telegram Client
      │ (Webhook HTTPS POST)
      ▼
src/routes/telegram.ts (Thin Webhook Router)
      │
      ├─► Commands (/start, /help, /cancel, /missions, /create, /registrants, /stats, /health, /notifications)
      ├─► Callback Queries (nav:*, m:*, v:*, wiz:*, confirm:*, edit:*, delete:*, notify:*)
      ├─► Wizard State Machine (create_*, edit_value, delete_confirm, cancelreg_*)
      └─► Intent Fallback (NLP / Regex query dispatcher)
            │
            ▼
Shared Service & Domain Layer
      ├─► src/services/mission.service.ts
      ├─► src/services/admin.service.ts
      ├─► src/services/audit.service.ts
      └─► src/services/notification_outbox.ts
            │
            ▼
Authoritative SQLite Database (Cloudflare D1)
```

---

## 2. Telegram Entrypoint & Routing

### 2.1 Webhook Router (`src/routes/telegram.ts`)
- **Endpoint**: `POST /telegram`
- **Security Check**: Extracts `chat_id` and checks authorization against `ADMIN_CHAT_IDS`.
- **Command Dispatcher**: Parses incoming text commands, removes `@botname` suffixes (e.g. `/start@redcrescent_minya_adminbot`), and validates role permissions before executing command handlers.
- **Callback Dispatcher**: Immediately calls `tgAnswerCb` to clear client-side loading indicators and routes to `src/telegram/callbacks.ts`.
- **Wizard Interceptor**: Prioritizes active in-progress wizard sessions before falling back to intent resolution.

---

## 3. Command Registry

| Command | Role | Description | Handler |
|---------|------|-------------|---------|
| `/start` | Public & Admin | Displays personalized dashboard (Admin Dashboard for admins, registration portal info for public). | `startCommandHandler` |
| `/help` | Public & Admin | Displays context-aware help documentation. | `helpCommandHandler` |
| `/cancel` | Public & Admin | Clears any active session state and returns to home screen. | `cancelCommandHandler` |
| `/missions` | Admin Only | Displays paginated task list with filter tabs (`ALL`, `OPEN`, `CLOSED`). | `handleListMissions` |
| `/create` | Admin Only | Launches the 7-step interactive mission creation wizard. | `startCreateWizard` |
| `/volunteers` | Admin Only | Displays cross-mission volunteer list with pagination. | `handleAllVolunteers` |
| `/search` | Admin Only | Opens member search prompt (by member ID or name). | `handleSearch` |
| `/registrants` | Admin Only | Opens mission picker to view confirmed and waitlisted volunteers. | `handleMissionSelectForRegistrants` |
| `/stats` | Admin Only | Displays enhanced system statistics (missions, registrations, today count, most active). | `handleStats` |
| `/notifications`| Admin Only | Displays and toggles real-time Telegram registration notification alerts with precedence info. | `handleNavNotifications` |
| `/activity` | Admin Only | Displays live activity feed from audit_logs with pagination and manual refresh. | `handleActivityFeed` |
| `/health` | Admin Only | Verifies system connectivity (D1 Database, Backend, Bot, Outbox). | `handleHealth` |

---

## 4. Callback Registry

| Prefix Pattern | Purpose | Handlers & Actions |
|----------------|---------|-------------------|
| `nav:*` | Top-level navigation | `nav:home`, `nav:missions`, `nav:create`, `nav:volunteers`, `nav:activity`, `nav:search`, `nav:stats`, `nav:health`, `nav:notifications`, `nav:help`, `nav:cancel` |
| `m:*` | Mission lifecycle & detail | `m:page:<filter>:<page>`, `m:detail:<id>`, `m:regs:<id>`, `m:waitlist:<id>`, `m:link:<id>`, `m:close:<id>`, `m:reopen:<id>`, `m:edit:<id>`, `m:delete:<id>`, `m:whatsapp:<id>`, `m:export:<id>`, `m:notify_toggle:<id>` |
| `v:*` | Volunteer management | `v:detail:<regId>`, `v:audio:<regId>`, `v:promote:<regId>`, `v:demote:<regId>`, `v:move:<regId>:<status>`, `v:cancel:<regId>` |
| `search:*` | Member search | `search:prompt:member_id`, `search:prompt:name`, `search:page:<page>` |
| `vol:*` | All volunteers view | `vol:page:<page>:<filter>`, `vol:filter:<status>` |
| `act:*` | Activity feed | `act:page:<page>` |
| `wiz:*` | Create mission wizard | `wiz:create:start`, `wiz:create:skip:<field>`, `wiz:create:confirm`, `wiz:create:cancel`, `wiz:restart` |
| `confirm:*` | Sensitive action verification | `confirm:delete:<missionId>`, `confirm:cancel:<regId>` |
| `edit:*` | Field editing | `edit:field:<field>:<missionId>` |
| `delete:*` | Mission deletion picker | `delete:pick:<missionId>` |
| `notify:*` | Notification preferences | `notify:toggle:<on\|off>` |

---

## 5. Admin Authorization Architecture

Authorization strictly follows the principle of least privilege:
1. `isAdmin(chatId, adminChatIds)`: Pure predicate evaluating whether `chatId` is in the comma-separated whitelist. Empty/unset whitelist allows first-contact setup.
2. `requireAdmin(token, chatId, db, adminChatIds)`: Guard function that stops unauthorized execution, logs the attempt, and sends a polite redirect message without exposing internal endpoints.
3. Every sensitive action (`create`, `edit`, `delete`, `close`, `reopen`, `promote`, `demote`, `cancel`, `audio_view`, `export_csv`) runs through `requireAdmin`.

---

## 6. Task Lifecycle & State Machine

```
                  ┌──────────────┐
                  │    DRAFT     │
                  └──────┬───────┘
                         │ (m:reopen / m:open)
                         ▼
                  ┌──────────────┐
      ┌──────────►│     OPEN     │◄──────────┐
      │           └──────┬───────┘           │
      │ (m:reopen)       │ (m:close / auto)  │ (m:reopen)
      │                  ▼                   │
┌─────┴────────┐  ┌──────────────┐   ┌───────┴──────┐
│  CANCELLED   │  │    CLOSED    │   │  COMPLETED   │
└──────────────┘  └──────┬───────┘   └──────────────┘
                         │ (confirm:delete)
                         ▼
                  ┌──────────────┐
                  │   DELETED    │
                  └──────────────┘
```

- **OPEN Actions**: Close Registration (`m:close`), Edit Fields (`m:edit`), View Registrants (`m:regs`), View Waitlist (`m:waitlist`), Share Link (`m:link`), WhatsApp Broadcast (`m:whatsapp`), Export CSV (`m:export`), Delete (`m:delete`).
- **CLOSED Actions**: Reopen Mission (`m:reopen` — sets `status='OPEN'` and `registration_close_at=null`), Edit, View Registrants, View Waitlist, Export CSV, Delete.

---

## 7. Volunteer Lifecycle & Seat Mechanics

```
Volunteer Registers
        │
        ├─► If Seat Available ──► CONFIRMED (Seat allocated: N)
        │
        └─► If Capacity Full ───► WAITLIST (Position: #K)
                                      │
               ┌──────────────────────┴──────────────────────┐
               │                                             │
      (Admin Promotes / Seat Freed)                 (Admin Demotes)
               │                                             │
               ▼                                             ▼
           CONFIRMED                                     WAITLIST
               │                                             │
               └──────────────────────┬──────────────────────┘
                                      │ (Admin Cancels)
                                      ▼
                                  CANCELLED
                         (Auto-promotes next in waitlist)
```

- **Promotion**: When a volunteer is promoted from `WAITLIST` to `CONFIRMED`, `seat_number` is allocated, `waitlist_position` is cleared, and subsequent waitlist positions are decremented.
- **Cancellation**: When a `CONFIRMED` volunteer is cancelled, their seat is freed and the first volunteer in `WAITLIST` is automatically promoted to that seat.

---

## 8. Recording Audio Flow

1. Volunteer uploads voice note during registration (`audio_confirmations` table).
2. Admin taps `🎙️ تشغيل التسجيل` (`v:audio:<regId>`).
3. Handler reads base64-encoded audio from D1 `audio_confirmations`.
4. Decodes base64 payload into binary bytes (`Uint8Array`).
5. Calls `tgSendVoice` using multipart form upload to Telegram API with proper MIME type and duration.

---

## 9. Notification & Outbox Integration

- **Outbox Table**: `notification_events` with `status='PENDING'`.
- **Worker Cron Processor**: Scheduled every minute (`* * * * *`).
- **Delivery**: Reads pending events, formats Rich HTML notification with volunteer and mission metadata, and dispatches to admin chats.

---

## 10. Service Dependencies

| Service | File | Purpose |
|---------|------|---------|
| Mission Service | `src/services/mission.service.ts` | CRUD operations, availability calculation, cascade deletes |
| Admin Service | `src/services/admin.service.ts` | Admin authentication and permission management |
| Audit Service | `src/services/audit.service.ts` | Tamper-evident logging of administrative actions |
| Outbox Processor| `src/services/notification_outbox.ts` | Durable async notification dispatching |
