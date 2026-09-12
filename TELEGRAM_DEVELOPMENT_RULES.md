# 📋 TELEGRAM_DEVELOPMENT_RULES.md
## قواعد التطوير الإلزامية — Telegram Bot for Red Crescent Minya

---

## 🎯 القواعد الأساسية العشرة (Non-Negotiable)

### 1. **Single Source of Truth — لا مصدر بيانات ثاني**
> كل عمليات البيانات تمر عبر **Service Layer** الموجود (`mission.service.ts`, `admin.service.ts`, `audit.service.ts`).
> 
> ❌ ممنوع: `db.prepare('INSERT...')` في command files  
> ✅ مطلوب: `await createMission(db, data)` أو `await updateMission(db, id, data)`

### 2. **No Duplicate Business Logic — لا تكرار للمنطق**
> إذا احتجت منطق موجود في Website/Admin Panel، استخدم الـ service اللي بيعمله.
> 
> ❌ ممنوع: نسخ منطق seat allocation أو waitlist promotion في bot  
> ✅ مطلوب: استدعاء `getMissionAvailability` و `updateMission` من الـ service

### 3. **Service-First Architecture — الخدمة أولاً**
> أي feature جديدة في Website محتاجة admin functionality → لازم تتعمل **Application Service** أولاً، وبعدين Telegram بيستهلكها.
> 
> ```
> New Feature
>      ↓
> Application Service / Domain Logic
>      ↓
> Website uses it  ←  Telegram uses it (same service)
> ```

### 4. **Idempotency — منع التكرار**
> كل عملية destructive أو notification لازم تكون **idempotent**.
> 
> - `request_id` في التسجيل يمنع التسجيل المكرر
> - Callback buttons تعمل `tgAnswerCb` فوراً وتمنع double-click
> - `settings` table upsert للـ notifications

### 5. **Error Isolation — عزل الأخطاء**
> فشل الإشعار (Telegram API) **مش** يفشل التسجيل في DB.
> 
> ```typescript
> // صح
> registration = await registerVolunteer()  // ← ينجح
> sendTelegramNotification()                 // ← fire-and-forget، لو فشل لا يؤثر
> 
> // غلط
> await registerVolunteer()
> await sendTelegramNotification()  // لو فشل → registration يفشل
> ```

### 6. **No Silent Failures — لا أخطاء صامتة**
> كل خطأ يُسجل في console مع context كامل.
> 
> ```typescript
> try {
>   await handleToggleRegistration(...)
> } catch (err) {
>   console.error('[TG] Toggle failed:', err)  // ← log كامل
>   await tgSend(token, chatId, '❌ فشل: ' + err.message)
> }
> ```

### 7. **Security First — الأمان أولاً**
> - لا `TELEGRAM_BOT_TOKEN` في الكود (wrangler secret فقط)
> - لا hardcoded chat IDs (ADMIN_CHAT_IDS env var)
> - Authorization check في **كل** callback و text message
> - لا stack traces للـ user

### 8. **Testable Design — قابل للاختبار**
> كل command function توقيعها: `(token, chatId, db, ...)` — سهلة للاختبار مع mock DB.
> 
> ```typescript
> // قابل للاختبار
> export async function handleToggleRegistration(
>   token: string,
>   chatId: number,
>   db: D1Database,
>   missionId: string,
>   open: boolean
> ): Promise<void>
> ```

### 9. **No Global Mutable State — لا حالة مشتركة متغيرة**
> كل admin conversation مستقل — session في D1 per chat_id.
> 
> ❌ ممنوع: متغيرات global في memory  
> ✅ مطلوب: `getSession/setSession` في D1

### 10. **Documentation as Code — التوثيق جزء من الكود**
> أي command/feature جديد → يحدث `TELEGRAM_ARCHITECTURE.md` و `TELEGRAM_DEVELOPMENT_RULES.md`.

---

## 🏗️ Code Organization Rules

### File Naming
```
commands/           ← كل command في ملف مستقل
  start.ts          ← /start, /help, /cancel
  missions.ts       ← list, detail, stats, link, whatsapp, export
  create.ts         ← wizard creation
  edit.ts           ← edit fields
  toggle.ts         ← open/close
  delete.ts         ← delete wizard
  registrants.ts    ← view, detail, audio, move
  cancel-reg.ts     ← cancel wizard
```

### Import Pattern (إلزامي)
```typescript
// ✅ صح — individual imports
import { tgSend, clearSession, getSession, setSession } from '../bot';
import { formatDate, statusLabel, formatCreateSummary } from '../formatters';
import { mainMenuKeyboard, cancelWizardKeyboard } from '../keyboards';
import { createMission, getMissionById } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';
import { InlineKeyboard } from 'grammy';

// ❌ غلط — namespace imports
import { bot } from '../bot';
import { formatters } from '../formatters';
import { keyboards } from '../keyboards';
```

### Function Signatures
```typescript
// جميع command functions:
// - أول 3 params: token, chatId, db
// - باقي params: IDs أو data بسيطة
// - return: Promise<void> (بتستخدم tgSend للرد)

export async function handleXxx(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string,  // أو regId, أو data بسيط
  open?: boolean
): Promise<void>
```

---

## 🧪 Testing Requirements

### Unit Tests (لكل command file)
- [ ] Happy path مع mock DB
- [ ] Validation errors (input مش صالح)
- [ ] Not found errors (mission/volunteer مش موجودة)
- [ ] Authorization failure

### Integration Tests
- [ ] Full wizard flow (create mission 7 steps)
- [ ] Callback dispatching (كل prefix)
- [ ] Wizard state transitions

### E2E Test Scenario
```
1. Admin: /start → main menu
2. Admin: "اعمل مهمة" → wizard 7 steps → confirm
3. Admin: يفتح التسجيل
4. Volunteer: يسجل على Website + voice
5. Admin: يستقبل notification + voice
6. Admin: يشوف المسجلين
7. Admin: يلغي واحد → waitlist promotion
8. Admin: يصدر CSV
```

---

## 🚀 Deployment Process

### Prerequisites
1. Cloudflare account + Workers paid plan (لـ AI binding)
2. D1 database created (`red-crescent-minya`)
3. R2 bucket (اختياري، للصوتيات) — `red-crescent-minya-audio`

### Secrets (wrangler)
```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put ADMIN_CHAT_IDS
# مثال: 123456789,987654321
```

### Database Migration
```bash
# Local
wrangler d1 execute red-crescent-minya --file=./migrations/0001_init.sql

# Production
wrangler d1 execute red-crescent-minya --file=./migrations/0001_init.sql --remote
```

### Deploy
```bash
npm run deploy  # wrangler deploy --env production
```

### Webhook Setup
```bash
# بعد النشر، سجل webhook:
curl -X POST "https://<your-worker>.workers.dev/telegram/setWebhook?url=https://<your-worker>.workers.dev/telegram"
```

---

## ⚠️ Common Pitfalls

| Pitfall | Prevention |
|---------|------------|
| `bot.` namespace usage | استخدم individual imports، grep قبل commit |
| `formatters.` / `keyboards.` | نفس الشيء — راجع `registrants.ts` كمرجع |
| ناسي `await tgAnswerCb` في callback | كل callback handler يبدأ بـ `await tgAnswerCb(token, cb.id)` |
| Handler مش بيستدعي service | مراجعة: كل DB operation عبر service function |
| Webhook بيرجع غير 200 | `return c.json({ ok: true })` دائماً |
| TypeScript errors في CI | شغّل `npm run typecheck` قبل push |
| Session مش بتتسجل في D1 | تأكد من `telegram_sessions` table موجود |
| Audio مش بيشتغل في Telegram | تحقق من R2 binding، أو fallback D1 base64 |

---

## 🔄 Adding New Features (Checklist)

عند إضافة feature جديد (مثلاً: "إرسال رسالة جماعية للمسجلين"):

1. [ ] أضف method في `mission.service.ts` أو `registration.service.ts` الجديد
2. [ ] أضف command handler في `commands/broadcast.ts` (أو file مناسب)
3. [ ] أضف keyboard buttons في `keyboards.ts`
4. [ ] أضف formatter في `formatters.ts`
5. [ ] أضف callback prefix في `callbacks.ts`
6. [ ] أضف wizard steps لو محتاجة (في `wizard.ts`)
7. [ ] أضف intent patterns في `intent.ts`
8. [ ] حدث `TELEGRAM_ARCHITECTURE.md` (Commands + Callback Structure + Flow)
9. [ ] حدث `TELEGRAM_DEVELOPMENT_RULES.md` لو قاعدة جديدة
10. [ ] اكتب Unit + Integration tests
11. [ ] شغّل `npm run typecheck`
12. [ ] Test E2E على Telegram
13. [ ] Deploy

---

## 📝 Git Commit Convention

```
feat(telegram): add broadcast message to registrants
fix(telegram): handle waitlist promotion on cancel
refactor(telegram): extract audio delivery to service
docs(telegram): update architecture for v3.1
test(telegram): add e2e test for create mission wizard
```

---

## 📅 Version History

| Version | Date | Changes |
|---------|------|---------|
| 3.0 | 2026-09-12 | Complete rebuild — modular architecture, service-based, wizard system |
| 2.x | Legacy | Monolithic 1619-line file, duplicate logic, direct DB queries |

---

## 📞 Support

- **Architecture questions**: راجع `TELEGRAM_ARCHITECTURE.md`
- **Rule violations**: راجع الـ 10 قواعد أعلاه
- **TypeScript errors**: `npm run typecheck` + راجع import pattern
- **Runtime errors**: console logs في Cloudflare Dashboard → Workers → Logs

---

*Last Updated: 2026-09-12*
*Author: Hermes Agent (rebuild v3.0)*
*Status: Active — must be followed for all future Telegram bot development*