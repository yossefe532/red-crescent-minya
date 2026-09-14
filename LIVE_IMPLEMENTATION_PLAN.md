# LIVE IMPLEMENTATION PLAN — نظام التسجيل المباشر للمهمات

**التاريخ:** 2026-09-14
**الحالة:** ✅ Phase 1 مكتمل — الخطة جاهزة للتنفيذ
**يعتمد على:** AI_IMPLEMENTATION_AUDIT.md (commit d465d04) + فحص كود فعلي

---

## ⚠️ صوابع في الـAudit logits تم تصحيحها بالفحص الفعلي

| الـAudit logits الفعلي | الواقع في الكود |
|-------------------------|-----------------|
| لا يوجد `request_id` في registrations | **موجود بالفعل** — `request_id TEXT UNIQUE` + index `idx_registrations_request_id` |
| لا يوجد `updated_at` في registrations | **موجود بالفعل** — في `volunteers` و `admin_users` و `quick_profiles` لكن **ليس في `registrations`** — وده سبب D1_ERROR المستمر |
| Duplicate prevention client-side فقط | نصف صحيح: الـUNIQUE constraints موجودة لكن مفيش idempotency mechanism في الـendpoint |

---

## 1. الوضع الحالي الفعلي

### جداول موجودة ومفيدة (لا نعدّلها)
| جدول | الاستخدام | 활용 في Live Registration |
|-------|----------|--------------------------|
| `missions` | بيانات المهمات | ✅ Buddy: registration_open/close, waiting_list, capacity |
| `registrations` | التسجيلات الرسمية (بـ member_id) | ✅ هو الجدول الأساسي — نضيف ownership columns عليه |
| `temporary_registrations` | التسجيلات المؤقتة (بدون member_id) | ⚠️ **محتاج ownership** + **مش ظاهر في live roster** |
| `volunteers` | بيانات المتطوعين | ✅ Buddy: identity source + member_id lookup |
| `quick_profiles` | التسجيل السريع | ✅ Buddy: auto-fill |
| `audio_confirmations` | التسجيلات الصوتية | ✅ Buddy: playback |
| `notification_events` | Outbox Telegram | ✅ **نعيد استخدامه بالكامل** — نضيف event types جديدة |
| `audit_logs` | سجل الإجراءات | ✅ Buddy: audit trail |
| `registration_attempts` | تتبع المحاولات | ⚠️ **يمكن تطويره** ليكون idempotency mechanism |
| `admin_users` / `admin_sessions` | مصادقة الإدارة | ✅ Buddy: admin auth |

### APIs موجودة ومفيدة
| Endpoint | الاستخدام | التعديل المطلوب |
|----------|----------|----------------|
| `GET /api/missions/:code` | بيانات المهمة + counts | ✅ بدون تعديل |
| `GET /api/missions/:code/status` | Fast polling | ✅ بدون تعديل |
| `GET /api/missions/:code/registrations-live` | الـLive roster | ⚠️ **نعدّله** — يضيف temporary + ownership info |
| `POST /api/register` | التسجيل الرسمي | ⚠️ **نعدّله** — ownership cookie + idempotency |
| `POST /api/register-temporary` | التسجيل المؤقت | ⚠️ **نعدّله** — ownership cookie |
| `POST /api/admin/registrations/:regId/cancel` | إلغاء الإدارة | ⚠️ **نعدّله** — يدعم restore + promotion logic موحدة |
| `GET /api/admin/missions/:id/registrations` | قائمة التسجيلات للإدارة | ⚠️ **نعدّله** — يضيف ownership info |

### APIs جديدة مطلوبة
| Endpoint | الاستخدام |
|----------|----------|
| `POST /api/registrations/:id/self-cancel` | إلغاء ذاتي (يتطلب ownership verification) |
| `GET /api/missions/:code/my-registrations` | جلب التسجيلات الخاصة بالجهاز (ownership cookie) |
| `POST /api/admin/registrations/:id/restore` | استرجاع التسجيل من الإدارة |

### Scheduler حالي
- `cron: ["* * * * *"]` — كل دقيقة
- ي xử lý `notification_events` outbox بالكامل
- الـregistration.ts يستدعي `processPendingNotifications` inline فور التسجيل (instant delivery)

---

## 2. الاستراتيجية الفعلية

### Ownership Strategy
```
المتصفح يصل لصفحة المهمة
↓
Backend يتحقق: هل يوجد ownership_token في الكوكي؟
↓
لا → Backend ينشئ UUID جديد + يخزنه في كوكي HttpOnly + SameSite=Lax
↓
yes → Backend يستخدم ownership_token الحالي
↓
عند التسجيل: ownership_token يُحفظ مع التسجيل في registrations
↓
عند العودة: ownership_token يُستخدم لجلب "تسجيلاتك"
↓
عند الإلغاء: ownership_token يُتحقق منه server-side
```

**ملاحظات:**
- `ownership_token` في `registrations` و `temporary_registrations` — **stored as plaintext** (مش hashed) لأن الكوكي himself هو الـtoken
- الـcookie: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=365*24*60*60` (سنة)
- **لا نستخدم IP** كـprimary ownership mechanism — IP ممكن يتغير (mobile data)
- الـtoken مرتبط **بالجهاز/المتصفح** مش بالشخص — لو شخص سجل 3 متطوعين من نفس المتصفح، كلهم مملوكيت له

### Duplicate Prevention Strategy
1. **Client-side:** زر submit يتعطّل بعد الضغط (موجود بالفعل)
2. **Server-side idempotency:** نستخدم `idempotency_key` من الكوكي (ownership_token + mission_id + member_id) مع `request_id` constraint
3. **Web Level:** الـUNIQUE constraint على `(mission_id, volunteer_id)` و `(mission_id, phone)` — existing

### Waitlist Promotion Strategy
نستخرج logic الإلغاء والترقية في **دالة مشتركة** تُستخدم من:
- Admin cancel
- Self cancel
- Telegram cancel

```
cancelRegistration(db, registrationId, cancellationType) {
  1. فحص الحالة الحالية
  2. تحديث الحالة → CANCELLED + cancelled_at
  3. لو كان CONFIRMED وله seat_number:
     a. جلب أول registered waitlist (order by waitlist_position ASC)
     b. ترقيته: → CONFIRMED + seat_number + confirmed_at + waitlist_position = NULL
     c. تحديث waitlist_position لباقي القائمة: -1 لكل registered > old position
  4. لو تم الترقية: return promotedVolunteer
  5. return null
}
```

### Restore Strategy (Admin Only)
**قبل التنفيذ: الـstate الحالي لا يحتفي بما يكفي لعمل restore ذكي.** نحتاج:
- `cancelled_by` — مين ألغى (admin, self, system)
- `cancelled_at` — موجود بالفعل ✅
- `original_status` — الحالة الأصلية قبل الإلغاء (CONFIRMED أو WAITLIST)
- `restored_at` — وقت الاسترجاع

**الخطة:**
```
restoreRegistration(db, registrationId, adminId) {
  1. فحص: هل التسجيل CANCELLED؟
  2. فحص: هل تم الترقية بعد الإلغاء؟ (is_restored = 0 + was_confirmed)
  3. لو كان CONFIRMED:
     a. هل لا يزال هناك مقعد شاغر؟ → نعيده CONFIRMED
     b. لو لا يوجد مقعد → نrevoke الترقية Happened الحالية أولاً:
        - نلغي أقرب متطوع تم ترقيته (CONFIRMED → CANCELLED temporarily)
        - نعيد التسجيل الأصلي CONFIRMED
        - نعيد المتطوع المُرقى → WAITLIST (position = next available)
  4. لو كان WAITLIST:
     a. نعيده WAITLIST مع position = next available
  5. return { restored, revokedPromotion? }
}
```

### Concurrency Strategy
**Cloudflare D1 uses SQLite** — مفيش async locking متقدم، لكن:
1. D1 batched operations = transaction guarantees
2. نستخدم `db.batch([...])` لكل cancellation/promotion operation
3. نتحقق من الحالة **قبل** كل UPDATE باستخدام SELECT
4. نستخدم WHERE conditions في UPDATE تمنع race conditions
5. **نختبر:**
   - نقرتين cancel في نفس اللحظة
   - cancel + registration في نفس اللحظة
   - cancel + admin restore في نفس اللحظة

### Realtime Strategy
**الحالة:** Frontend بيعمل polling كل 3 ثواني للم registrations + كل ثانية للstatus
**القرار: نبقى على polling محسّن**
- Cloudflare Workers: مفيش WebSocket native
- SSE ممكن لكن بيتقطع مع كل cron execution
- الـpolling الحالي شغال — نحسّنه فقط:
  1. نضيف `version` field في status endpoint
  2. Frontend يخزّن آخر version — لو مش متحنّش، نتخطى الـupdate
  3. نقلل payload: `/status` endpoint خفيف بالفعل ✅

---

## 3. Migration Strategy

### 0009_live_registration_ownership.sql

```sql
-- Ownership columns for device tracking
ALTER TABLE registrations ADD COLUMN ownership_token TEXT;
ALTER TABLE temporary_registrations ADD COLUMN ownership_token TEXT;

-- Restore support
ALTER TABLE registrations ADD COLUMN original_status TEXT;
ALTER TABLE registrations ADD COLUMN restored_at TEXT;
ALTER TABLE registrations ADD COLUMN cancelled_by TEXT
  CHECK(cancelled_by IN ('admin', 'self', 'system', NULL));

-- Idempotency key (optional, for double-submit prevention)
ALTER TABLE registrations ADD COLUMN idempotency_key TEXT UNIQUE;

-- Restore tracking
ALTER TABLE temporary_registrations ADD COLUMN original_status TEXT;
ALTER TABLE temporary_registrations ADD COLUMN restored_at TEXT;
ALTER TABLE temporary_registrations ADD COLUMN cancelled_by TEXT
  CHECK(cancelled_by IN ('admin', 'self', 'system', NULL));

-- Indexes
CREATE INDEX IF NOT EXISTS idx_reg_ownership ON registrations(ownership_token);
CREATE INDEX IF NOT EXISTS idx_reg_idempotency ON registrations(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_temp_reg_ownership ON temporary_registrations(ownership_token);
CREATE INDEX IF NOT EXISTS idx_reg_cancelled_by ON registrations(cancelled_by);
```

**ملاحظات:**
- كل العمليات `ALTER TABLE ADD COLUMN` — **إضافة فقط، لا حذف**
- SQLite بيدعم `ALTER TABLE ADD COLUMN` بدون مشاكل
- `ownership_token TEXT` — nullable للتسجيلات القديمة (backward compatible)
- `original_status TEXT` — nullable للتسجيلات غير المُلغاة

---

## 4. التفاصيل التقنية

### A. Ownership Middleware

**ملف جديد:** `backend/src/middleware/ownership.ts`

```typescript
// Ensures ownership_token cookie exists, reads or generates it
// Attaches to Hono context for downstream handlers
export async function ownershipMiddleware(c: Context, next: Next) {
  let token = c.req.header('Cookie')?.match(/ownership_token=([^;]+)/)?.[1];
  if (!token) {
    token = crypto.randomUUID();
    c.header('Set-Cookie', 
      `ownership_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365*24*60*60}`
    );
  }
  c.set('ownership_token', token);
  await next();
}
```

### B. Registration Endpoints Modifications

#### `POST /api/register` (registration.ts)
- **إضافة:** ownership_token cookie → مع التسجيل
- **إضافة:** Idempotency check (idempotency_key من ownership_token + mission_id + volunteer_id)
- **إزالة:** لا نمنع التسجيل المتعدد — نمنع التسجيل المكرر لنفس الشخص فقط

#### `POST /api/register-temporary` (quick.ts)
- **نفس التعديلات** مع ownership_token
- Duplicate check: phone + mission (موجود بالفعل)

### C. Self-Cancellation Endpoint

**ملف جديد:** `backend/src/routes/self-cancel.ts`

```
POST /api/registrations/:id/self-cancel
Headers: Cookie: ownership_token=xxx
Body: { mission_public_code: string }

1. Fetch registration + volunteer
2. Verify ownership_token matches
3. Verify registration.status != CANCELLED
4. Call shared cancelRegistration()
5. Create audit log
6. Queue Telegram notification (cancellation event)
7. Return success
```

### D. My Registrations Endpoint

**تعديل:** `public.ts` — نضيف:

```
GET /api/missions/:publicCode/my-registrations
Headers: Cookie: ownership_token=xxx

1. Find registrations WHERE ownership_token = ? AND mission_id = ?
2. Find temporary_registrations WHERE ownership_token = ? AND mission_id = ?
3. Return combined list with volunteer info
```

### E. Admin Restore Endpoint

**إضافة في:** `admin.ts`

```
POST /api/admin/registrations/:id/restore
Auth: adminAuth

1. Fetch registration
2. Verify status == CANCELLED
3. Determine original_status (from registration metadata)
4. If was CONFIRMED:
   a. Is there available seat? → Restore directly
   b. No available seat → Revoke most recent promotion, restore original
5. If was WAITLIST:
   a. Restore with next available waitlist position
6. Create audit log
7. Queue Telegram notification (restored event)
8. Return success
```

### F. Telegram Events

**نضيف event types في `notification_outbox.ts`:**
- `REGISTRATION_CANCELLED`
- `REGISTRATION_PROMOTED`
- `REGISTRATION_RESTORED`
- `MISSION_FULL`

**ال-messages تُبنى بنفس النمط existing — نعيد استخدام `createNotificationEvent()`**

### G. Frontend Modifications

**ملف:** `frontend/src/pages/MissionRegistration.tsx`

#### التعديلات:
1. **بعد التسجيل:** لا نعرض شاشة "شكراً" — نعرض شاشة "تسجيلاتك" مع زر إلغاء
2. **العودة للصفحة:** لو فيه ownership_token + registrations، نعرض "تسجيلاتك" أولاً
3. **الصفحة ممتلئة:** لا نخفي الصفحة — نعرض roster + رسالة "المقاعد مكتملة" + form مخفي
4. **Live Roster:** نضيف toast notification للتسجيلات الجديدة + animation pulse

#### إضافة في `frontend/src/api/public.ts`:
```typescript
export async function getMyRegistrations(publicCode: string): Promise<MyRegistration[]>
export async function selfCancelRegistration(regId: string, publicCode: string): Promise<CancelResult>
```

---

## 5. التسلسل المنطقي للتنفيذ

### Phase 1: Ownership + Foundation (الأساس)
1. ✅ كتابة الخطة (هذا الملف)
2. Migration 0009: ownership columns + restore columns
3. Ownership middleware
4. Ownership cookie في backend
5. TypeScript compile

### Phase 2: Self-Cancellation
1. Extract `cancelRegistration()` shared function
2. Self-cancel endpoint
3. My registrations endpoint
4. Admin cancel → reuse shared function
5. TypeScript compile + test

### Phase 3: Admin Restore
1. Admin restore endpoint
2. Restore logic (revoke promotion if needed)
3. TypeScript compile + test

### Phase 4: Live Roster Fix + Events
1. Fix `registrations-live` to include temporary_registrations
2. Add new Telegram events (CANCELLED, PROMOTED, RESTORED, FULL)
3. TypeScript compile

### Phase 5: Frontend — Post-Registration Flow
1. Show "your registrations" after success
2. Self-cancel button
3. Full mission accessible (roster visible)
4. Build + deploy

### Phase 6: Frontend — Live Animations + Toasts
1. Toast notifications for new registrations
2. Pulse animation on new entries
3. Respect prefers-reduced-motion
4. Build + deploy

### Phase 7: Concurrency Testing + E2E
1. Race condition tests
2. Full E2E test (A through T)
3. Deploy all

---

## 6. Rollback Strategy

**كل migration يضيف أعمدة فقط (ADD COLUMN)** — لا حذف.

لو حدث مشكلة:
1. الأعمدة الجديدة nullable → النظام القديم يتجاهلها
2. الـendpoints الجديدة لا تؤثر على endpoints القديمة
3. الـfrontend القديم لا يستخدم ownership cookie → يعمل كالعادة
4. الـrollback: `ALTER TABLE` لا يدعم DROP COLUMN في SQLite — ن Columms جديدة تبقى فارغة

**الRisk:** مفيش rollback كامل لأن SQLite لا يدعم `DROP COLUMN`. الحل: الأعمدة nullable [];

---

## 7. Security Considerations

1. **Ownership token:** `HttpOnly` + `SameSite=Lax` — لا يتعرض لـXSS
2. **Self-cancel verification:** ownership_token يُتحقق server-side — لا يعتمد على frontend
3. **Admin auth:** موجود بالفعل — لا نبطّل他任何
4. **Rate limiting:** ممكن نضيف rate limit على self-cancel endpoint
5. **No phone/ID exposure:** live roster لا يعرض أي معلومات حساسة

---

## 8. الملفات المتأثرة (apeshit)

### ملفات جديدة:
| ملف | الاستخدام |
|------|----------|
| `backend/migrations/0009_live_registration_ownership.sql` | Schema additions |
| `backend/src/middleware/ownership.ts` | Ownership cookie middleware |
| `backend/src/routes/self-cancel.ts` | Self-cancellation endpoint |
| `backend/src/services/cancel.service.ts` | Shared cancellation + promotion logic |
| `backend/src/services/restore.service.ts` | Restore logic |

### ملفات معدّلة:
| ملف | التعديل |
|------|--------|
| `backend/src/index.ts` | Add ownership middleware + self-cancel routes |
| `backend/src/routes/registration.ts` | Add ownership_token to INSERT |
| `backend/src/routes/quick.ts` | Add ownership_token to INSERT |
| `backend/src/routes/public.ts` | Add my-registrations + fix registrations-live |
| `backend/src/routes/admin.ts` | Add restore endpoint + reuse cancel service |
| `frontend/src/api/public.ts` | Add new API functions |
| `frontend/src/pages/MissionRegistration.tsx` | Post-registration flow + self-cancel UI + live roster |
| `frontend/src/pages/Registration.tsx` | Same changes if different file |

### ملفات لا تتغير:
- `backend/src/services/mission.service.ts` ✅
- `backend/src/telegram/` (كلها) ✅ — نضيف handlers فقط لا نعدّل existing
- `backend/src/middleware/auth.ts` ✅
- `backend/src/services/admin.service.ts` ✅
- `backend/src/services/notification_outbox.ts` ✅ — نعيد استخدامه

---

## 9. Testing Checklist (Phase-by-Phase)

### After Phase 1 (Ownership):
- [ ] `npx tsc --noEmit` passes
- [ ] ownership_token cookie created on first visit
- [ ] ownership_token persists across page reloads
- [ ] Old registrations still work (ownership_token is nullable)

### After Phase 2 (Self-Cancellation):
- [ ] Self-cancel works for CONFIRMED registration
- [ ] Self-cancel works for WAITLIST registration
- [ ] Self-cancel fails if ownership_token doesn't match
- [ ] Self-cancel fails if registration already CANCELLED
- [ ] Waitlist promotion happens correctly after self-cancel
- [ ] My registrations shows all owned registrations

### After Phase 3 (Admin Restore):
- [ ] Admin can restore CANCELLED → CONFIRMED (if seat available)
- [ ] Admin can restore CANCELLED → WAITLIST
- [ ] Admin restore revokes promotion if no seat available
- [ ] Admin cannot restore non-CANCELLED registration
- [ ] Audit log created for restore

### After Phase 4 (Live Roster):
- [ ] Temporary registrations appear in live roster
- [ ] Live roster shows name only (no phone/ID)
- [ ] Telegram notification sent for cancellation
- [ ] Telegram notification sent for promotion
- [ ] Telegram notification sent for restore

### After Phase 5 (Frontend):
- [ ] After registration: "your registrations" shown
- [ ] Self-cancel button visible
- [ ] Full mission: roster visible, form hidden
- [ ] Registration link stays accessible after full
- [ ] Back button returns to roster view

### After Phase 6 (Animations):
- [ ] Toast notification for new registration
- [ ] Pulse animation on new roster entry
- [ ] Count updates immediately
- [ ] prefers-reduced-motion respected
- [ ] Mobile friendly

### E2E Tests (A through T):
- [ ] A. First registration
- [ ] B. Second person from same browser
- [ ] C. Third person from same browser
- [ ] D. Reload page → registrations persist
- [ ] E. Return to full mission → roster visible
- [ ] F. Self cancel
- [ ] G. Multiple self cancellations
- [ ] H. Mission reaches full → page stays
- [ ] I. New user after full → WAITLIST
- [ ] J. Existing user cancels after full
- [ ] K. Waitlist promotion
- [ ] L. Admin cancellation
- [ ] M. Admin restoration
- [ ] N. Restore after promotion
- [ ] O. Simultaneous registrations
- [ ] P. Multiple tabs
- [ ] Q. Telegram notification
- [ ] R. Realtime reconnect
- [ ] S. Browser restart → ownership persists
- [ ] T. Different device cannot cancel

---

**الخطة جاهزة. ابدأ التنفيذ Phase 1 عند الموافقة.**
