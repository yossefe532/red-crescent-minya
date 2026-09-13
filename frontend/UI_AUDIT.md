# 🔍 UI Audit Report — نظام الهلال الأحمر المصري (فرع المنيا)

> **تاريخ التدقيق:** 13 سبتمبر 2026
> **النطاق:** الواجهة الأمامية فقط (`frontend/`) — React 18 + TypeScript + Vite + TailwindCSS v3
> **الغرض:** فحص فعلي من الكود للواجهة الحالية، تمهيدًا لتطويرها لواجهة احترافية **دون التأثير على الوظائف**.
> **القاعدة الصارمة:** تحليل فقط — **لا تعديلات** في هذه المرحلة.

---

## 1. Current UI Overview

### 1.1 البنية العامة

المشروع واجهة أمامية صغيرة مكونة من **3 صفحات فقط**، بدون Layout مشترك، بدون Sidebar، بدون Header عام:

| الملف | الدور | الحجم |
|------|------|------|
| `src/pages/MissionRegistration.tsx` | صفحة التسجيل العامة (الرابط `/m/:code`) | ~994 سطر |
| `src/pages/AdminDashboard.tsx` | لوحة تحكم الأدمن (الرابط `/admin`) | ~850 سطر |
| `src/pages/MissionControlPanel.tsx` | مودال لوحة تحكم المهمة الواحدة (داخل الأدمن) | ~505 سطر |
| `src/App.tsx` | التوجيه (Routes) | 17 سطر |
| `src/main.tsx` | نقطة الدخول + React Query | 26 سطر |
| `src/index.css` | تنسيقات عامة + 6 كلاسات مخصصة | 44 سطر |

### 1.2 التوجه (Routing)

```tsx
<Route path="/m/:code" element={<MissionRegistration />} />   // صفحة التسجيل العامة
<Route path="/admin" element={<AdminDashboard />} />          // لوحة تحكم الأدمن
<Route path="/" element={<Navigate to="/admin" replace />} /> // إعادة توجيه
<Route path="*" element={<Navigate to="/admin" replace />} /> // fallback
```

- لا يوجد **Layout** مشترك (لا Header عام، لا Footer، لا Shell).
- `/` يعيد التوجيه إلى `/admin` — أي زائر غير مسجّل يرى شاشة تسجيل دخول الأدمن.
- لا توجد حماية صريحة للطريق (`ProtectedRoute` أو `RequireAuth`) — الحماية تتم داخل الصفحة عبر `checkSession()`.

### 1.3 التكنولوجيا

| الطبقة | الاختيار |
|--------|----------|
| UI Framework | React 18.3.1 (مع StrictMode) |
| Language | TypeScript 5.5 |
| Bundler | Vite 5.4 |
| Styling | TailwindCSS 3.4 (دون plugins) |
| Routing | react-router-dom 6.27 |
| Data fetching | @tanstack/react-query 5.59 + fetch مخصص |
| UI Library | **لا توجد** (MUI / Chakra / Antd / Radix / HeadlessUI ... غير موجودة كلها) |
| Icon Library | **لا توجد** — كل الأيقونات **Emoji / Unicode** |
| Animation Library | **لا توجد** — يعتمد على كلاسات Tailwind فقط (`animate-fadeIn`, `animate-scaleUp` مخصصة محليًا) |
| Fonts | Inter (Google Fonts) — فقط للعناوين اللاتينية، لا يوجد خط عربي مخصص |
| Auth | Token في `localStorage` (`rc_admin_token`) + header `X-Auth-Token` |

### 1.4 ملاحظة على الاعتماديات

- `hono` موجود في `dependencies` بالفرونت — وهذا **شاذ** (Backend framework يعمل بالـWorker) ويُضيف حجمًا غير ضروري للـbundle. يُنصح بنقله أو حذفه عند أخذ الإذن.

---

## 2. Pages Inventory

### PAGE: صفحة تسجيل المهمة (الجمهور)

| البند | الوصف |
|-------|-------|
| **الاسم** | MissionRegistration |
| **route** | `/m/:code` |
| **الهدف** | تمكين المتطوع من التسجيل في مهمة (بالاسم + رقم العضوية + هاتف + **تسجيل صوتي إلزامي** لعبارة التأكيد) |
| **المستخدم المستهدف** | المتطوعون بالجمعية (عامة، عبر رابط واتساب) |
| **أهم العناصر** | شاشة تحميل المهمة، نموذج التسجيل (اسم/عضوية/هاتف)، **مسجّل صوتي** (MediaRecorder)، شاشة نجاح/انتظار/ممتلئة، استرجاع بيانات سابقة (Quick Profile) |
| **أهم الـcomponents** | مودال نجاح، عداد وقت التسجيل الصوتي، مؤشر حالة (مؤكد/انتظار) |
| **أهم الـactions** | تسجيل، تسجيل صوتي، حفظ بيانات سريع، إعادة تسجيل |
| **مشاكل UX الحالية** | (1) `user-scalable=no` يمنع تكبير الخط (مشكلة إتاحة كبيرة). (2) لا يوجد خطأ توضيحي لكل حقل. (3) شاشة الفل/الممتلئة لا تشرح مصير الزائر جيدًا. (4) لا يوجد "متابعة الحالة" للمسجّل لاحقًا. (5) عند تحميل الصوت لا يوجد مؤشر تقدم upload. |
| **مشاكل visual design الحالية** | نموذج بسيط بـ `rounded-xl` متكرر، لا يوجد توازن بصري (كل شيء white + slate + red)، **لا يوجد شعار/هوية**، الأيقونات emoji متفرقة بلا نظام |
| **مستوى التعقيد** | **7/10** (يحتوي مسجّل صوتي + حالات متعددة + تكامل Quick Profile) |

### PAGE: لوحة تحكم الأدمن (الرئيسية)

| البند | الوصف |
|-------|-------|
| **الاسم** | AdminDashboard |
| **route** | `/admin` |
| **الهدف** | تسجيل دخول الأدمن + عرض قائمة المهمات + إحصائيات + إدارة تسجيلات كل مهمة + إنشاء مهمة |
| **المستخدم المستهدف** | مدير النظام / مسئول الجمعية |
| **أهم العناصر** | شاشة Login، KPI stats (مهمات مفتوحة/إجمالي/متطوعين)، بطاقات المهمات، مودال إنشاء مهمة، جدول تسجيلات مع بحث وفلاتر، تشغيل صوتي |
| **أهم الـcomponents** | MissionCard، CreateMissionModal، RegistrationsTable، AudioPlayer |
| **أهم الـactions** | تسجيل دخول/خروج، إنشاء مهمة، فتح Control Panel، إلغاء تسجيل، تشغيل صوت، بحث/فلترة، نسخ رابط/واتساب |
| **مشاكل UX الحالية** | (1) **كل شيء في صفحة واحدة طويلة** — الـDashboard أشبه بقائمة طويلة وليس لوحة تحكم. (2) البحث والفلترة يعملان على Client فقط (حجم قليل حاليًا لكنه لن يتحمل النمو). (3) مودال إنشاء مهمة يعرض نجاح بخطوات غير واضحة. (4) لا يوجد تأكيد مدمج أنيق للإلغاء (يستخدم `confirm()` المتصفح). (5) لا توجد حالة "No missions" مصممة. |
| **مشاكل visual design الحالية** | كل البطاقات متشابهة slate/white/red، لا يوجد تمييز هرمي بين "مفتوحة/مغلقة/مكتملة"، لا يوجد استخدام للألوان كمعنى بصري، جدول المسجلين مزدحم بلا فواصل بصرية |
| **مستوى التعقيد** | **8/10** (الأكثر تعقيدًا: حالات متعددة + مودالات + جدول + صوت) |

### PAGE: لوحة تحكم المهمة (مودال)

| البند | الوصف |
|-------|-------|
| **الاسم** | MissionControlPanel |
| **route** | (داخل `/admin` — مودال) |
| **الهدف** | عرض وتعديل وإدارة مهمة واحدة: نظرة عامة، تعديل التفاصيل، إعدادات (فتح/إغلاق/حذف التسجيل، إغلاق نهائي، حذف نهائي) |
| **المستخدم المستهدف** | مدير النظام |
| **أهم العناصر** | 3 Tabs (نظرة عامة/تعديل/إعدادات)، بطاقات معلومات ملونة (مكان/وصف/توقيت/عبارة صوتية)، نموذج تعديل، أزرار خطرة |
| **أهم الـcomponents** | Tabs (يدوية بـ useState)، StatCard زرقاء/خضراء/حمراء |
| **أهم الـactions** | حفظ تعديلات (Optimistic)، فتح/إغلاق تسجيل (Optimistic)، إغلاق نهائي، حذف نهائي |
| **مشاكل UX الحالية** | (1) زر "حذف نهائي" بجانب "إغلاق نهائي" بدون فصل بصري قوي (خطر). (2) الاعتماد على `confirm()` للمتصفح بدل مودال تأكيد مخصص. (3) **Optimistic update بدون رد حقيقي** — يعرض "تم الحفظ" فورًا قبل نجاح الـAPI، ومع الـrollback لا يخبر المستخدم بوضوح. (4) ألوان البطاقات (blue/amber/purple) لا تتبع نظامًا دلاليًا ثابتًا. |
| **مشاكل visual design الحالية** | الهيدر gradient داكن (slate-900) مع خط أحمر سفلي — جيد لكنه يختلف كليًا عن بقية الواجهة؛ بطاقات معلومات بألوان متعددة (أزرق/كهرماني/بنفسجي) تشتت الانتباه |
| **مستوى التعقيد** | **7/10** |

---

## 3. Components Inventory

**ملاحظة هامة:** لا يوجد مجلد `components/` مستخدم — المجلد موجود لكنه **فارغ**. كل المكونات مكتوبة **داخل الصفحات** حصرًا.

| # | المكوّن | الموقع | الوصف | قابلية إعادة الاستخدام |
|---|---------|--------|-------|------------------------|
| 1 | LoginForm | AdminDashboard | نموذج username/password مع error | 🟡 يُستخرج |
| 2 | StatsGrid (KPI) | AdminDashboard | 3-4 بطاقات إحصائية | 🟡 يُستخرج (Card/Stat) |
| 3 | MissionCard | AdminDashboard | بطاقة مهمة (كود، عنوان، حالة، عدد مؤكد/انتظار، أزرار) | 🟢 Component جاهز |
| 4 | CreateMissionModal | AdminDashboard | نموذج إنشاء مهمة + نجاح + نسخ رابط/واتساب | 🟡 يُستخرج |
| 5 | RegistrationsTable | AdminDashboard | جدول المسجلين (بحث/فلتر/صوت/إلغاء) | 🟡 يُستخرج |
| 6 | StatusBadge | AdminDashboard | شارة مؤكد/انتظار/ملغي (مضمنة في الجدول) | 🟢 يُعمَّم |
| 7 | AudioPlayerButton | AdminDashboard | زر تشغيل/استماع للصوت | 🟢 يُعمَّم |
| 8 | MissionControlPanel | صفحة مستقلة | مودال تحكم كامل (Tabs) | 🟡 يصبح Component رسميًا |
| 9 | VoiceRecorder | MissionRegistration | مسجّل صوت (MediaRecorder + مؤقت + إيقاف) | 🟢 Component قيّم |
| 10 | SuccessModal | MissionRegistration | شاشة نجاح التسجيل (مؤكد/انتظار) | 🟢 يُعمَّم |
| 11 | ProfileLookup | MissionRegistration | استرجاع بيانات سابقة برقم العضوية | 🟢 يُعمَّم |
| 12 | Alert (success/error) | متفرق | شريط تنبيه أخضر/أحمر مكرر في كل مكان | 🟢 **الأهم — يُعمَّم** |

### الأنماط المكتشفة (Design Patterns)

1. **عدم وجود مكونات مشتركة** — كل زر/بطاقة/إدخال مكتوب `className` كامل inline في كل مرة (تكرار هائل).
2. **6 كلاسات عامة فقط** في `index.css`: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.input`, `.card`, `.label` — **لكن معظم الصفحات لا تستخدمها!** الصفحات تعيد كتابة الكلاسات مباشرة.
3. **No Toast system** — يستخدم `setTimeout` لإخفاء رسائل مؤقتة.
4. **No Modal system** — كل مودال مكتوب يدويًا بـ `fixed inset-0 + bg-black/60`.
5. **No Dropdown / Menu / Tooltip / Pagination component**.
6. **Animations**: `animate-fadeIn`, `animate-scaleUp` معرّفة محليًا داخل الصفحات (وليس في `tailwind.config`).

---

## 4. Navigation Analysis

### 4.1 الوضع الحالي

| العنصر | الحالي | المشكلة | الاقتراح |
|--------|--------|---------|----------|
| **Sidebar** | **غير موجود** | لا يوجد هيكل تنقل جانبي | إضافة Sidebar ثابت للأدمن (Desktop) يتحول Drawer على Mobile |
| **Header** | **غير موجود** (فقط Header داخل مودال Control Panel) | لا يوجد شريط علوي موحّد | إضافة Header أعلى الـDashboard (شعار + اسم + خروج) |
| **Navigation items** | لا توجد روابط داخلية | لا تنقل بين أقسام | Dashboard / المهمات / المتطوعون / الإعدادات (حسب النمو الحالي) |
| **Bottom nav (mobile)** | غير موجود | التنقل على الموبايل مفقود تمامًا | Drawer أو Bottom nav مبسّط (3-4 عناصر فقط) |
| **Breadcrumbs** | غير موجودة | لا يعرف المستخدم مكانه | إضافة Breadcrumbs بسيطة |
| **Back button** | غير موجود | التنقل للخلف يعتمد على المتصفح | زر رجوع في المودالات والصفحات |
| **الترتيب** | غير قابل للتطبيق (لا عناصر) | — | أولوية: Dashboard ← المهمات ← التقارير ← الإعدادات |

### 4.2 الهيكل المقترح (المستقبلي)

```
┌──────────────────────────────────────────────┐
│ Header: [شعار] الهلال الأحمر — المنيا  [خروج] │
├──────────┬───────────────────────────────────┤
│ Sidebar  │  Content Area                     │
│ 🏠 لوحة   │                                   │
│ 📋 مهمات  │                                   │
│ 👥 متطوعون│                                   │
│ 📊 تقارير │                                   │
│ ⚙️ إعدادات│                                   │
└──────────┴───────────────────────────────────┘
```

**التوصيات الأساسية:**
- على Mobile: Sidebar يتحول إلى **Drawer** (من اليمين في RTL) + شريط سفلي مبسّط اختياري.
- **لا حاجة** لـ Bottom Navigation كامل — التطبيق صغير، Drawer يكفي.

---

## 5. Icon Inventory

### 5.1 الخلاصة الحاسمة

> **لا توجد مكتبة أيقونات في المشروع إطلاقًا.**
> البحث في كل ملفات `*.tsx` عن `lucide / heroicons / react-icons / @fortawesome / Fa* / Hi* / Bs* / Md* / Io*` أعاد **0 نتيجة**.
> كل الأيقونات المستخدمة هي **Emoji / Unicode characters** مباشرة في النص.

### 5.2 جدول الأيقونات (Emoji) حسب الاستخدام

| الصفحة | الأيقونة | الاستخدام | هل مناسبة؟ | الاقتراح |
|--------|----------|-----------|-------------|----------|
| MissionRegistration | `⚠️` | تحذير إغلاق/خطأ | ❌ أحمر على أحمر غير واضح | `AlertTriangle` (lucide) |
| MissionRegistration | `🔒` | ممتلئة/مغلقة | ❌ تختلف بالـsystem | `Lock` / `Ban` |
| MissionRegistration | `✓` | نجاح | ✅ لكنها نصية | `CheckCircle2` |
| MissionRegistration | `⏳` | انتظار | 🟡 تُقرأ غامضة | `Clock` / `Timer` |
| MissionRegistration | `ℹ️` | معلومة | 🟡 | `Info` |
| MissionRegistration | `📝` | بيانات محفوظة | 🟡 emoji يُعرض differently | `FileText` / `UserCheck` |
| MissionRegistration | `📍` | مكان | 🟡 | `MapPin` |
| MissionRegistration | `🎙️` | تسجيل صوتي | 🟡 (يختلف حسب المنصة) | `Mic` / `MicOff` |
| MissionRegistration | `⏹️` | إيقاف التسجيل | 🟡 | `Square` (stop) |
| AdminDashboard | `⚠️` | خطأ تسجيل الدخول | ❌ | `AlertCircle` |
| AdminDashboard | `✓` | نجاح | ✅ | `CheckCircle2` |
| AdminDashboard | `📍` | موقع المهمة | 🟡 | `MapPin` |
| AdminDashboard | `⚙️` | لوحة التحكم / إعدادات | 🟡 emoji | `Settings` / `SlidersHorizontal` |
| AdminDashboard | `📋` | نسخ / قائمة | 🟡 | `Copy` / `ClipboardList` |
| AdminDashboard | `✕` | إغلاق | ✅ لكن غير متناسق (✕/× / ✖) | `X` |
| AdminDashboard | `▶` | تشغيل الصوت | ✅ أساسي | `Play` |
| MissionControlPanel | `🔒` / `🔓` | فتح/إغلاق تسجيل | 🟡 | `Lock` / `LockOpen` |
| MissionControlPanel | `🚫` | إغلاق نهائي | 🟡 | `Ban` / `XCircle` |
| MissionControlPanel | `🗑️` | حذف | 🟡 emoji | `Trash2` |
| MissionControlPanel | `📊` | نظرة عامة | 🟡 | `LayoutDashboard` / `BarChart3` |
| MissionControlPanel | `✏️` | تعديل | 🟡 | `Pencil` / `Edit3` |
| MissionControlPanel | `⚙️` | إعدادات | 🟡 | `Settings` |
| MissionControlPanel | `🟢` / `🔴` | مفتوح/مغلق | ❌ ألوان غير متاحة بسهولة للـa11y | `BadgeCheck` + ألوان دلالية |
| MissionControlPanel | `📍` / `📝` / `🗓️` / `🎤` | حقول التفاصيل | 🟡 | `MapPin` / `FileText` / `Calendar` / `Mic` |

### 5.3 التوصية النهائية للأيقونات

- المكتبة الموصى بها: **`lucide-react`** (واحدة فقط، لا تعدد مكتبات).
- الأسباب: (1) خفيفة (~1KB لكل أيقونة tree-shaken)، (2) stroke-based وتعمل مع RTL بسهولة، (3) متوافقة مع Tailwind (تتلوّن بـ `text-*`)، (4) مجانية ومفتوحة المصدر.
- البديل الأقل حزمًا: `react-icons` (لكنها تحوي آلاف الأيقونات وتُحمّل أكثر).

**Icon System الموحد المقترح:**
| الفئة | الأيقونة |
|-------|----------|
| Dashboard | `LayoutDashboard` |
| Missions | `ClipboardList` / `ListChecks` |
| Volunteers | `Users` |
| Reports | `BarChart3` |
| Settings | `Settings` |
| Add/Create | `Plus` / `PlusCircle` |
| Edit | `Pencil` |
| Delete | `Trash2` |
| Close | `X` |
| Back | `ArrowRight` (RTL!) |
| Copy | `Copy` |
| Search | `Search` |
| Play/Stop audio | `Play` / `Square` |
| Success | `CheckCircle2` |
| Warning | `AlertTriangle` |
| Error | `AlertCircle` |
| Info | `Info` |
| Lock/Open | `Lock` / `LockOpen` |

---

## 6. Color Analysis

### 6.1 الألوان الفعلية المستخرجة من الكود

| الدور | القيمة الحالية | المصدر |
|-------|---------------|--------|
| **Primary (أحمر)** | `#dc2626` (red-600) | `tailwind.config.js`: `rc.red`, والأزرار `bg-red-600` |
| **Primary dark** | `#b91c1c` / `#991b1b` | `rc.dark` + `hover:bg-red-700` |
| **Primary light** | `#fecaca` | `rc.light` |
| **Background** | `#f9fafb` (gray-50) | `index.css` body |
| **Surface (بطاقات)** | `#ffffff` | `.card` وكل المودالات |
| **Border** | `#f1f5f9` (slate-100) / `#e2e8f0` (slate-200) / `#cbd5e1` (slate-300) | كل الحدود |
| **Text primary** | `#0f172a` (slate-900) | عناوين |
| **Text body** | `#334155` (slate-700) / `#64748b` (slate-500 muted) | نصوص |
| **Text muted** | `#94a3b8` (slate-400) | placeholders |
| **Success** | `#059669` (emerald-600) / `#d1fae5` (emerald-100) | مؤكد/نجاح |
| **Warning** | `#d97706` (amber-600) / `#fef3c7` (amber-100) | انتظار |
| **Error/Danger** | `#dc2626` (red-600) / `#fee2e2` (red-100) | خطأ/حذف |
| **Info** | `#2563eb` (blue-600) / `#dbeafe` (blue-100) | (نادرًا في Control Panel) |
| **Dark header (Control Panel)** | `#0f172a` → slate-800 gradient | Header المودال |

### 6.2 تقييم الهوية

- ✅ الاتجاه الحالي **صحيح المبدأ**: أحمر كلون Accent على أساس محايد (slate/gray) — هذا ما طلبته الهوية.
- ❌ **لكنه غير مدروس**: الأحمر يُستخدم للعديد من المعاني المتضاربة: Primary للزر، Error للخطأ، Danger للحذف، "مغلق" في Control Panel — **نفس اللون `red-600` بمعانٍ مختلفة** في نفس الواجهة. هذا أخطر مشكلة لونية.
- ❌ لا توجد تدرجات حمراء (Red Crescent هوية) — فقط `red-50..900` من Tailwind الافتراضي + قيم `rc` الثلاث.
- 🟡 لا يوجد استخدام للـSurface المتدرج / تقسيم المناطق (هرم بصري ضعيف).

### 6.3 المبدأ التوجيهي (لا نريد واجهة حمراء بالكامل)

| المكون | المبدأ |
|--------|--------|
| الخلفية | `#f8fafc` (slate-50) أو أبيض — الأغلبية محايد |
| الـSurface | أبيض + حدود slate-200 خفيفة |
| **Accent Primary (إجراءات أساسية)** | أحمر واحد مدروس فقط، مثل `#C8102E` أو `#DC2626` ثابت |
| **Error/Destructive** | أحمر مختلف أو درجة أغمق (مثلاً `#B91C1C` أو برتقالي=`#B45309` للحذف الحرج) |
| **Success** | emerald-600 |
| **Neutral text** | slate-800/600/400 ہرمي |

**مقترح Palette (مفصل في القسم 16).**

---

## 7. Typography Analysis

### 7.1 الحالي

| البند | القيمة |
|-------|--------|
| **Font family** | `Inter, system-ui, sans-serif` (من Google Fonts في `index.html`) |
| **Font sizes** | لا يوجد scale مخصص — يستخدم Tailwind الافتراضي: `text-xs` (12px) للجداول/الأزرار، `text-sm` (14px) للنماذج، `text-base` (16px) للأجسام، `text-3xl`/`text-4xl` للـKPI |
| **Font weights** | `font-semibold` (600) و `font-black` (900) هما الأكثر استخدامًا؛ `font-bold` (700) للعديد |
| **Headings** | `text-xl font-black` / `text-2xl font-black` (عناوين الصفحات والمودالات) |
| **Body** | `text-sm text-slate-600` غالبًا |
| **Labels** | `text-xs font-bold text-slate-700` |
| **Buttons** | `font-bold` على `text-sm` في الغالب |
| **Tables** | `text-xs` مع `font-mono` للأرقام والمعرفات |
| **RTL** | `dir="rtl"` في `index.html` ✅ — لكن الخط **Inter لا يدعم العربية**! |

### 7.2 المشكلة الحرجة

> **Inter لا يحتوي على حروف عربية.** عند عرض نص عربي سيسقط المتصفح إلى `system-ui` (خط النظام). لا يوجد خط عربي محمّل (لا Cairo، لا Tajawal، لا IBM Plex Sans Arabic، لا Noto Kufi Arabic...).

### 7.3 التوصية

| البند | المقترح |
|-------|---------|
| الخط الرئيسي | **Cairo** أو **IBM Plex Sans Arabic** (أكثر احترافية) أو **Tajawal** (أقرب للواجهات الحكومية النظيفة) |
| الخط الاحتياطي | `system-ui, -apple-system, 'Segoe UI', sans-serif` |
| Headings | نفس العائلة + `font-bold/black` |
| ارتفاعات الأسطر | `leading-relaxed` / `leading-7` للنصوص الطويلة (الوصف) |
| مقاسات الـTypography Scale | مقترح في القسم 16 |

---

## 8. Cards Analysis

### 8.1 الأنواع الموجودة (مستخرجة من الكود)

| # | النوع | أين | المحتوى | الشكل | Border radius | Shadow | Padding |
|---|-------|-----|---------|-------|---------------|--------|---------|
| 1 | **MissionCard** | AdminDashboard | كود + عنوان + حالة + مؤكد/انتظار + أزرار (لوحة/إغلاق) | أبيض | `rounded-2xl` | `shadow-sm` | `p-6` |
| 2 | **KPI Stat** | AdminDashboard (أعلى) | رقم كبير + تسمية (مفتوحة/إجمالي/متطوعين) | أبيض/خلفيات ملونة | `rounded-2xl` | `shadow-sm` | `p-6` |
| 3 | **Info Stat (Control Panel)** | MissionControlPanel (Overview) | سعة/حالة التسجيل | slate-50 | `rounded-2xl` | none | `p-4` |
| 4 | **Info Block (Location/Desc/Time/Phrase)** | MissionControlPanel | أزرق/كهرماني/بنفسجي/رمادي | خلفيات ملونة فاتحة | `rounded-2xl` | none | `p-4` |
| 5 | **Success Card (Create modal)** | AdminDashboard | تم الإنشاء + رابط + واتساب | أبيض/أخضر | `rounded-2xl` | none | `p-3` |
| 6 | **Message Boxes (success/error)** | كل الصفحات | شريط نجاح/خطأ مؤقت | emerald/red-50 | `rounded-xl` | none | `px-4 py-3` |
| 7 | **Settings danger zones** | MissionControlPanel | إغلاق/حذف نهائي | red/amber-50 | `rounded-2xl` | none | `p-5` |

### 8.2 ماذا نحتفظ / نوحّد / نتخلص

| القرار | البند |
|--------|-------|
| ✅ **احتفظ** | MissionCard الأساسية (بنية جيدة) + KPI cards (تحتاج توحيد) + فكرة الـSettings zones |
| 🟡 **وحّد** | كل `rounded-xl` مقابل `rounded-2xl` (اختيار واحد فقط)؛ كل البطاقات يجب أن تتبع نظامًا: `rounded-2xl border border-slate-200 bg-white shadow-xs` |
| ❌ **تخلص من / أعد تصميم** | بطاقات الـInfo الملونة المتعددة (blue/amber/purple) في Control Panel — تستخدم أصواتًا متعددة بدون معنى دلالي؛ استبدلها بنظام واحد: أيقونة + تسمية + قيمة على Surface أبيض موحد |
| ❌ **تخلص** | استخدام emoji كـ"icon" داخل البطاقات (استبدله بـ lucide) |

---

## 9. Tables Analysis

### 9.1 الجدول الوحيد (RegistrationsTable)

| الخاصية | الحالي |
|---------|--------|
| **الأعمدة** | # (الترتيب) · اسم المتطوع · رقم العضوية · الحالة والمقعد · التسجيل الصوتي · وقت التسجيل · إجراءات |
| **Pagination** | ❌ غير موجودة — يعرض كل النتائج في صفحة واحدة |
| **Filtering** | ✅ فلترة بالحالة (CONFIRMED/WAITLIST/CANCELLED) — Client-side |
| **Sorting** | ❌ غير موجود |
| **Search** | ✅ بالاسم أو رقم العضوية — Client-side |
| **Row actions** | إلغاء التسجيل (نص أحمر) |
| **Status badges** | ✅ شارات مؤكد (emerald) / انتظار (amber) / ملغي (slate) |
| **Mobile behavior** | ❌ `overflow-x-auto` فقط — لا توجد نسخة mobile مصممة (بطاقات/تكديس) |
| **الحالة الفارغة** | نص بسيط "لا توجد تسجيلات" — بدون أيقونة/توضيح |

### 9.2 تصور الجدول الاحترافي (خفيف — بدون ثقل)

```
┌────┬──────────────┬──────────┬──────────┬──────────┬──────────┬────────────┐
│ #  │ المتطوع      │ العضوية  │ الحالة   │ الصوت    │ الوقت    │ إجراءات    │
├────┼──────────────┼──────────┼──────────┼──────────┼──────────┼────────────┤
│ 1  │ أحمد محمد    │ RC-001   │ [مؤكد#1] │ [▶ استماع]│ 10:02:31 │ [إلغاء]    │
└────┴──────────────┴──────────┴──────────┴──────────┴──────────┴────────────┘
```

**التوصيات:**
1. **اباتنة Server-side** عندما تتجاوز القوائم ~100 صف: تمرير `search`, `status`, `page` للـAPI (الـAPI يدعم `search` و `status` بالفعل من `admin.ts`).
2. إضافة **Pagination** (10/25/50 لكل صفحة) — أو **Infinite scroll** خفيف.
3. إضافة **Sorting** بالأعمدة (وقت التسجيل، الترتيب) بدون إضافة مكتبة — بسيط بالـuseState.
4. **Mobile**: تحويل الجدول إلى **بطاقات متكدسة** عند `sm` (كل تسجيل = بطاقة صغيرة) بدل التمرير الأفقي.
5. زر الإجراءات: تحويل النص إلى **menu (⋮)** مع خيارات (استماع، إلغاء، تفاصيل).
6. **الشارات**: توحيد شكل الشارة (pill) مع أيقونة صغيرة ملونة.

---

## 10. Dashboard Analysis

### 10.1 المعلومات الحالية (بالترتيب الحالي في الشاشة)

1. **Login screen** (إذا لم يسجل دخول)
2. **Header** مدمج: عنوان "لوحة تحكم الهلال الأحمر" + زر خروج
3. **KPI cards** (إجمالي المهمات / المفتوحة / إجمالي المتطوعين) — أعلى الصفحة (غير موجود دائمًا؟ يُظهر Stats)
4. **قائمة المهمات** — بطاقات متتالية
5. عند فتح مهمة: **جدول المسجلين** داخل نفس الشاشة + أزرار (لوحة التحكم، نسخ الرابط، تصدير CSV)
6. **مودال إنشاء مهمة**
7. **مودال MissionControlPanel**

### 10.2 المشاكل

- **لا يوجد hierarchy**: KPI ثم مباشرة قائمة طويلة — بدون أقسام، بدون "Recent Activity"، بدون تمييز المهمات النشطة.
- **لا توجد Charts** خالصة (بدون مكتبة رسوم) — يمكن الاكتفاء بتقدم شريطي بسيط.
- **لا يوجد Activity feed** ("آخر تسجيل: أحمد منذ 5 دقائق").
- **لا توجد Quick actions** (زر "إنشاء مهمة" موجود لكنه مدفون تحت المحتوى).
- **لا يوجد tab للأقسام** (مهمات نشطة / مغلقة / كلها).

### 10.3 الهيكل المقترح ("High density بدون clutter")

```
┌────────────────────────────────────────────────────────┐
│ Header: [الشعار] الهلال الأحمر — المنيا        [خروج]  │
├────────────────────────────────────────────────────────┤
│ KPI Row (4 بطاقات مدمجة):                              │
│ [مهمات نشطة] [إجمالي المهمات] [متطوعين مؤكدين] [انتظار]│
├────────────────────────────────────────────────────────┤
│ Quick Action Bar: [+ إنشاء مهمة] [⬇ تصدير]             │
├──────────────────────┬─────────────────────────────────┤
│ Tabs: [الكل|نشطة|مغلقة]│  (اختياري) جانب: آخر الأنشطة  │
│ قائمة المهمات         │  - تسجيل جديد                  │
│ (بطاقات مضغوطة)       │  - مهمة أُغلقت                 │
│                       │  - تم ترقية من الانتظار       │
└──────────────────────┴─────────────────────────────────┘
```

**مبادئ التصميم:**
- KPI أولًا (بأرقام كبيرة واضحة) → Quick Actions → المحتوى.
- الـ"Recent Activity" في عمود جانبي (Desktop) أو سطر قابل للطي (Mobile) — فقط آخر 5-7 أحداث.
- التباعد بين البطاقات منتظم (`gap-4/6`)، لا حشو.

---

## 11. Mobile / Tablet / Desktop Analysis

### 11.1 Breakpoints الحالية

| الحجم | الوضع الحالي | المشاكل |
|-------|--------------|---------|
| **Mobile (<640px)** | كل الصفحات تظهر عمودية؛ الجدول `overflow-x-auto`؛ المودالات `p-4` + `w-full max-w-lg` | (1) الجدول غير قابل للاستخدام الفعلي (تمرير أفقي طويل). (2) مسجّل الصوت: أزرار كبيرة قد تفيض. (3) **`user-scalable=no` يمنع الزوم** — كارثة إتاحة. (4) KPI cards تتراص عموديًا (مقبول). (5) لا يوجد Drawer/Nav. (6) touch targets بعض الأزرار أقل من 44px |
| **Tablet (640–1024px)** | نفس الموبايل تقريبًا؛ `sm:flex-row` في بعض الأماكن | الجدول ما زال أفقيًا؛ KPI بـ 2 أعمدة |
| **Laptop (1024–1440px)** | جيد؛ `max-w-*` للـContent | لا يوجد Sidebar — كل المحتوى بعرض الشاشة (يبدو ممتدًا بلا حدود) |
| **Desktop (>1440px)** | لا يوجد `max-w-screen-*` حقيقي للمحتوى | المحتوى يتمدد على شاشات عريضة بشكل غير مريح |

### 11.2 توصيات محددة

| المشكلة | الحل |
|---------|------|
| الجدول على الموبايل | تحويل لبطاقات عند `sm` (Card list view) |
| `user-scalable=no` | **حذف** `maximum-scale=1.0, user-scalable=no` من `index.html` |
| Sidebar | على Desktop: ثابت 240-260px؛ على Mobile: Drawer أيقونة ☰ |
| Modal على الموبايل | `max-h-[90vh]` + تمرير داخلي (موجود جزئيًا في Control Panel — يُعمَّم على كل المودالات) |
| Touch targets | كل الأزرار ≥ 44px ارتفاع (بعضها `py-1.5` = ~32px فقط) |
| Content container | `max-w-7xl mx-auto px-4 sm:px-6 lg:px-8` |
| الأداء على الأجهزة الضعيفة | تقليل `backdrop-blur` (يعمل GPU) + تجنب الأنيميشن الثقيل |

---

## 12. Accessibility Analysis

### 12.1 الوضع الحالي

| المعيار | الحالة |
|---------|--------|
| `lang="ar" dir="rtl"` | ✅ موجود |
| **خط عربي فعلي** | ❌ لا يوجد (Inter لاتيني فقط) — النص العربي يقع في fallback |
| **تكبير الخط** | ❌ ممنوع (`user-scalable=no`) |
| **Focus styles** | 🟡 جزئي: `focus:ring-2 focus:ring-red-500` على المدخلات، لكن الأزرار تعتمد على `focus:outline-none` بدون بديل مرئي |
| **ARIA labels** | ❌ غير موجودة (أزرار أيقونية مثل ✕ بلا `aria-label`) |
| **Alt text** | لا توجد صور/لوجو — غير مطبق |
| **Contrast** | 🟡 أزرار `text-slate-400` (مثل ﹘) و `text-[11px]` قد تكون ضعيفة؛ emoji الأخضر `🟢` بلا نص بديل (يقرأ "green circle") |
| **Keyboard navigation** | 🟡 المودالات لا تُغلق بـ Escape، ولا يوجد focus trap؛ لا يوجد `role="dialog"` |
| **Form labels** | ✅ معظمها مرتبطة بـ htmlFor/label — جيد |
| **Reduced motion** | ❌ لا يوجد احترام لـ `prefers-reduced-motion` |
| **Semantic HTML** | 🟡 كل الأزرار `button` ✅ لكن الجداول بـ `table` ✅، شارات حالة داخل `<span>` ✅ |

### 12.2 التوصيات

1. حذف `user-scalable=no`.
2. إضافة خط عربي + نسب خط أكبر (`text-base` بدل `text-xs` للأشياء المهمة).
3. `aria-label` لكل الأزرار الأيقونية (✕، ▶، ⋮).
4. Focus trap + Escape للمودالات (+ `role="dialog" aria-modal="true"`).
5. ألوان للنصوص: عدم استخدام slate-400 للنص الأساسي.
6. احترام `prefers-reduced-motion` عبر Tailwind `motion-reduce:`.
7. استبدال emoji الملونة (🟢🔴) بأنظمة status مع نص صريح.

---

## 13. Performance Analysis

### 13.1 العوامل الحالية

| العامل | الحالة | التأثير |
|--------|--------|---------|
| **حجم الـbundle** | Vite + React 18 + react-query + react-router — بدون UI/icon library كثيفة | 🟢 جيد حاليًا |
| **`hono` في dependencies** | غير مستخدم في الفرونت | 🟡 يضيف وزنًا بلا فائدة |
| **جلب البيانات** | react-query مع `staleTime: 5000` و `retry: 2` | 🟢 جيد (خارج نطاق العمل الحالي) |
| **Re-renders** | الصفحات كبيرة (850-994 سطر)؛ كل state داخل صفحة واحدة — تعديل search يعيد render الجدول كاملًا | 🟡 مقبول حاليًا، لكن مع النمو سيحتاج تقسيم |
| **Animations** | `animate-fadeIn`/`animate-scaleUp` خفيفة | 🟢 لا مشكلة |
| **`backdrop-blur-sm`** | في المودالات فقط | 🟢 خفيف |
| **Emoji بدل أيقونات** | emoji يستخدم خط النظام — يُعرض بشكل مختلف | 🟡 ثبات بصري لا أداء |
| **CSS** | Tailwind purged — صغير | 🟢 ممتاز |
| **Shadows** | `shadow-sm`/`shadow-2xl` محدودة | 🟢 جيد |
| **Charts** | لا توجد | 🟢 لا وزن |
| **Google Fonts** | Inter فقط | 🟡 (يمكن استبداله بخط عربي أفضل مع `display=swap`) |

### 13.2 التوصيات

1. **لا تُضف libraries ثقيلة** (لا Recharts ضخمة إلا للحاجة الفعلية، ولا Framer Motion — Animations خفيفة تكفي).
2. **إزالة/نقل `hono`** من الفرونت dependencies.
3. **مكوّنات مفصولة** (`components/`) للصفحات الكبيرة — ليس للأداء فورًا بل للقابلية.
4. عند الحاجة: `React.lazy()` لصفحة `MissionControlPanel` (مودال ثقيل يُفتح نادرًا).
5. **أيقونات lucide** تُضاف بشكل tree-shaken (أخف من emoji في التناسق).

---

## 14. Current Problems (ملخص المشاكل الأساسية)

### البنية
1. **لا يوجد نظام مكوّنات** — كل شيء مكرر inline في 3 صفحات كبيرة.
2. **المجلدات الفارغة** (`components/`, `utils/`) تشير لنية لم تكتمل.
3. **لا يوجد Layout** (لا Header/Sidebar/Shell).
4. **`hono` dependency** شاذة في الفرونت.

### الهوية والتصميم
5. **لا يوجد خط عربي** — Inter لا يغطي العربية.
6. **أيقونات Emoji** غير متناسقة وغير قابلة للتلوين.
7. **لا يوجد نظام ألوان مدروس** — الأحمر له معانٍ متضاربة.
8. **بطاقات Info متعددة الألوان** في Control Panel بدون دلالة.
9. **لا يوجد نظام spacing/radius/shadow موحّد**.

### الوظائف (UX)
10. **لا توجد حالة فارغة/تحميل/خطأ مصممة** بشكل كامل.
11. **`confirm()`** للمتصفح بدل مودال تأكيد أنيق (خطير UX).
12. **Optimistic updates بلا إشارة حقيقية** — رسالة النجاح فورية حتى لو فشل الـAPI لاحقًا.
13. **لا Pagination** في الجدول.
14. **لا Toast system** — رسائل تختفي بصمت.
15. **الجدول غير قابل للاستخدام على الموبايل** فعليًا.
16. **Accessibility**: `user-scalable=no`, لا ARIA, لا focus trap, لا Escape.

---

## 15. Recommended Design Direction

### الهوية المستهدفة

> **Egyptian Red Crescent inspired · Professional · Humanitarian · Modern · Trustworthy · Clean · Fast · Accessible · Arabic-first · Responsive**

### المبادئ (الـDesign Principles)

1. **Calm & Trustworthy** — الأغلبية محايدة (أبيض/رمادي فاتح)، الأحمر = هوية مدروسة فقط.
2. **Red as Accent, not Flood** — الأحمر للأفعال الأساسية والحالة الحرجة، وليس كخلفية.
3. **Arabic-first** — خط عربي ممتاز + اتجاه RTL + أرقام عربية حيث يناسب.
4. **Information Hierarchy** — KPI أولًا، ثم المحتوى، مع تباين واضح بين المستويات.
5. **Light & Fast** — بلا Gradients مبالغ، بلا Glassmorphism، بلا مكتبات ثقيلة.
6. **Consistent Components** — نظام واحد للبطاقات/الأزرار/المدخلات/الشارات.
7. **Mobile-first** — كل شيء يجب أن يعمل على شاشة 360px.
8. **Accessible by default** — وضوح تباين، تركيز مرئي، تكبير مسموح.

### النمط البصري (Visual Style)

| المعلمة | التوجيه |
|---------|---------|
| الشكل العام | **Clean SaaS dashboard** — أسطح بيضاء، حدود رفيعة، زوايا `rounded-xl`، ظلال ناعمة جدًا |
| الخلفيات | slate-50 للصفحة، أبيض للبطاقات |
| اللون الأحمر | هوية: `#C8102E` (أحمر الصليب الأحمر الدولي تقريبًا) أو `#DC2626` الحالي — **قيمة واحدة ثابتة** + درجات red-50..900 للخلفيات الفاتحة |
| اللمسات | شريط علوي رفيع أحمر (Red Crescent band) أسفل/أعلى الـHeader |
| الأنيميشن | انتقالات 150-200ms فقط، fade/slide خفيف |
| التكامل مع البيانات | شارات حالة ملونة مع أيقونات واضحة |
| لا نستخدم | لا glassmorphism، لا gradients مزدحمة، لا cards بألوان عشوائية، لا emoji |

**أمثلة مرجعية:** Linear / Vercel Admin / Stripe Dashboard (نظافة) + لمسة الهلال الأحمر عبر الشريط الأحمر والأيقونات.

---

## 16. Proposed Design System

### 1. Color Palette

| Token | HEX | الاستخدام |
|-------|-----|-----------|
| `--rc-red` | `#C8102E` | **الأحمر الأساسي (Accent)** — أزرار رئيسية، روابط، عناصر نشطة |
| `--rc-red-dark` | `#A00D24` | Hover / حالات Destructive |
| `--rc-red-light` | `#FDE8EC` | خلفيات أحمر فاتحة (توهج حالة) |
| `--bg-page` | `#F8FAFC` | خلفية الصفحة (slate-50) |
| `--surface` | `#FFFFFF` | البطاقات/المودالات |
| `--border` | `#E2E8F0` | حدود البطاقات/الحقول (slate-200) |
| `--text-primary` | `#0F172A` | عناوين |
| `--text-body` | `#334155` | نص أساسي |
| `--text-muted` | `#64748B` | نص ثانوي/مساعد |
| `--text-faint` | `#94A3B8` | Placeholder / غير نشط |
| `--success` | `#059669` | مؤكد/نجاح |
| `--warning` | `#D97706` | انتظار/تحذير |
| `--error` | `#DC2626` | أخطاء حقيقية (يتم تمييزها عن الـAccent بالسياق) |
| `--info` | `#2563EB` | معلومات |

> **قاعدة**: الأحمر الأساسي مخصص لوظيفة واحدة (Primary/Action). أخطاء وحذف = `--error` بدرجة أغمق أو بـ background مختلف.

### 2. Typography

| البند | المقترح |
|-------|---------|
| Headings | **Cairo** (ExtraBold 800/Black 900) — أو IBM Plex Sans Arabic (700) — مع `leading-tight` |
| Body | **Cairo** أو **Tajawal** Regular/Medium 400/500 — `text-base` (16px) بالافتراضي |
| Labels | `text-sm` (14px) `font-semibold` |
| Buttons | `text-sm font-bold` (14px) |
| Tables | `text-sm` (14px) للصفوف، headers `text-xs uppercase` |
| Numeric/IDs | `font-mono` (= `ui-monospace`) |
| Scale | 12/14/16/18/20/24/30/36 (`xs/sm/base/lg/xl/2xl/3xl/4xl`) |

### 3. Spacing

| Token | قيمة |
|-------|------|
| Space scale | Tailwind الافتراضي (4/8/12/16/20/24/32) — مع التزام: صفحات `p-6/p-8`، بطاقات `p-5/p-6`، حقول `p-3` |
| Gaps | `gap-4` بين البطاقات، `gap-6` بين الأقسام، `space-y-6` داخل الصفحة |

### 4. Border Radius

| Token | قيمة |
|-------|------|
| `--radius-sm` | `8px` (`rounded-lg`) — أزرار صغيرة/شارات |
| `--radius-md` | `12px` (`rounded-xl`) — حقول، أزرار، بطاقات صغيرة |
| `--radius-lg` | `16px` (`rounded-2xl`) — بطاقات رئيسية، مودالات |
| `--radius-full` | `9999px` — شارات/أفاتار |

### 5. Shadows

| Token | قيمة |
|-------|------|
| `--shadow-xs` | `0 1px 2px rgba(15,23,42,0.04)` — بطاقات افتراضية |
| `--shadow-sm` | `0 1px 3px rgba(15,23,42,0.08)` — بطاقات hover |
| `--shadow-md` | `0 4px 12px rgba(15,23,42,0.08)` — Dropdown/Modal |
| `--shadow-lg` | `0 8px 24px rgba(15,23,42,0.12)` — Modal مركز |

### 6. Buttons

| النوع | الشكل | الحالات |
|-------|-------|---------|
| Primary | `bg-rc-red text-white font-bold px-5 py-2.5 rounded-xl` | hover darker; disabled opacity-50 |
| Secondary | `bg-white text-slate-700 border border-slate-300` | hover:bg-slate-50 |
| Ghost | `text-slate-600 hover:bg-slate-100` | للأفعال الثانوية |
| Danger | `bg-red-600 text-white` (أو Outline للـDestructive الثانوي) | confirm داخل مودال |
| Icon-only | 40×40px + `aria-label` | للأزرار الأيقونية |

### 7. Inputs

```
w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5
text-sm text-slate-900 placeholder:text-slate-400
focus:border-rc-red focus:ring-2 focus:ring-rc-red/20
```

### 8. Selects
نفس الـInput + سهم مخصص (بدون emoji) + `appearance-none`.

### 9. Tables

```
Header: bg-slate-50 text-xs font-bold text-slate-500 uppercase
Rows: divide-y divide-slate-100 hover:bg-slate-50/60
Badges: pill مع dot ملون
Pagination أسفل الجدول
```

### 10. Cards

```
bg-white rounded-2xl border border-slate-200 shadow-xs p-6
مع اختياري: header بقسم منفصل p-5 border-b
```

### 11. Badges

| الحالة | الشكل |
|--------|-------|
| مؤكد | `bg-emerald-50 text-emerald-700` + dot emerald + `#رقم المقعد` |
| انتظار | `bg-amber-50 text-amber-700` + dot amber + `#رقم القائمة` |
| ملغي | `bg-slate-100 text-slate-500` |
| مغلق | `bg-slate-200 text-slate-600` |
| مفتوح | `bg-emerald-50 text-emerald-700` |

### 12. Status Indicators
**Dot + نص** دائمًا (لا ألوان وحدها) — `● مؤكد / ● انتظار / ● ملغي`.

### 13. Modals

```
fixed inset-0 z-50 bg-slate-900/50 (بدون blur ثقيل)
padding p-4، container bg-white rounded-2xl max-w-lg w-full shadow-lg
role="dialog" aria-modal="true"
Escape يغلق + focus trap + header بعنوان + زر X بـ aria-label
```

### 14. Toasts

```
نظام واحد toast: أسفل يمين (في RTL: أسفل يسار)
أنواع: success (CheckCircle2) / error (AlertCircle) / info (Info)
مدة 3-4 ثوانٍ + زر إغلاق + auto-dismiss
بدون مكتبة — مكوّن بسيط `ToastProvider` + context
```

### 15. Tooltips
`title` افتراضيًا أو Tooltip خفيف عند hover (بدون lib) — `role="tooltip"`.

### 16. Navigation

| الحجم | الشكل |
|-------|-------|
| Desktop | Sidebar ثابت 240px، عناصر بحجم 44px |
| Mobile | Drawer من اليمين (RTL) + toggle ☰ في Header |

### 17. Icons
**Lucide React** فقط — أحجام 16/18/20/24px، `stroke-width="2"`، لون `currentColor` (يتلوّن مع النصوص).

### 18. Empty States

```
أيقونة كبيرة (48px) رمادية + عنوان + وصف + CTA واحد
مثال: "لا توجد مهمات بعد" + [زر إنشاء مهمة]
```

### 19. Loading States

```
Skeleton cards (animate-pulse) للقوائم
Spinner صغير (border spinner) للأزرار (بدلاً من النص فقط)
لكل صفحة: حالة تحميل أولية واضحة
```

### 20. Error States

```
بطاقة خطأ مقروءة: أيقونة + رسالة + [إعادة المحاولة]
بدون رفع الـerror بصمت
```

---

## 17. Proposed Icon System

| النوع | القرار |
|-------|--------|
| المكتبة | **lucide-react** — الوحيدة المعتمدة |
| الحجم | `size={18}` أزرار، `size={20}` عناصر قائمة، `size={24}` في البطاقات الكبيرة، `size={16}` داخل النصوص |
| Color | `currentColor` — يتبع `text-*` |
| الـmap | (انظر جدول 5.3) |

**قاعدة التنفيذ:**
- حصر الأيقونات في قائمة صغيرة (~20-25) داخل مكوّن `Icon`؛ أي أيقونة جديدة تُضاف للقائمة الموثقة.
- **استبدال كامل للـEmoji**: أيقونة → Emoji (بحث شامل في 3 ملفات، كلها مُدرجة في الجدول 5.2).

---

## 18. Proposed Navigation

```
Route                            Layout
─────────────────────────────────────────────────
/admin                           AdminShell (Sidebar + Header + Content)
  ├── Dashboard (المهمات: نشطة/كلها)   ← الرئيسية
  ├── (مستقبلًا) المتطوعون
  ├── (مستقبلًا) التقارير
  └── (مستقبلًا) الإعدادات
/m/:code                         PublicShell (رأس خفيف + نموذج)
```

**العناصر المقترحة للـSidebar:**

| العنصر | الأيقونة | ملاحظة |
|--------|----------|--------|
| لوحة المهمات | `LayoutDashboard` | الرئيسية |
| إنشاء مهمة | `PlusCircle` | Quick action دائم |
| المتطوعون | `Users` | (لاحقًا) |
| التقارير | `BarChart3` | (لاحقًا) |
| الإعدادات | `Settings` | (لاحقًا) |

**Mobile:** Drawer + زر ☰؛ عند إغلاق الـDrawer يظهر **شريط سفلي مبسّط** (لوحة + إنشاء + خروج) اختياريًا.

---

## 19. Proposed Dashboard Structure

```
[Header: شعار + العنوان + زر خروج]

[شريط أحمر رفيع (هوية)]

[KPI Row — 4 بطاقات]
  | مهمات نشطة | إجمالي المهمات | مؤكدين | قائمة انتظار |

[Quick Actions Bar]
  [+ إنشاء مهمة]  [⬇ تصدير الكل]

[Main Grid: 3fr 1fr]
  ┌─────────────────────────┬──────────────────┐
  │ Tabs: [نشطة|الكل|مغلقة]  │ آخر الأنشطة      │
  │                         │  • تسجيل جديد    │
  │ Mission Cards (مضغوطة)   │  • مهمة أُغلقت   │
  │ - كود + عنوان + حالة     │  • ترقية انتظار  │
  │ - شريط تقدم (مؤكد/سعة)   │  (آخر 5)         │
  │ - أزرار: لوحة/نسخ/تصدير   │                  │
  └─────────────────────────┴──────────────────┘
```

**المعلومات مرتبة حسب الأهمية:**
1. الأرقام الحاسمة (KPI) — كم مهمة نشطة، كم مسجّل.
2. إجراء حاسم (إنشاء مهمة).
3. المهمات النشطة أولًا (مع شريط تقدم الامتلاء).
4. آخر الأحداث (Activity) — بشرط توفر الـبيانات من الـAPI لاحقًا.

---

## 20. Implementation Roadmap

> المراحل مرتبة: **Extend + Refine**، بدون Rebuild.

### المرحلة 0 — الأساسات (الهوية) — أول أسبوع
1. إضافة خط عربي (Cairo/Tajawal) في `index.html` + تحديث `tailwind.config`.
2. ضبط `index.css`: tokens (CSS variables) للون/مسافات/ظلال + كلاسات `btn/card/input` جاهزة.
3. حذف `user-scalable=no`.
4. إزالة `hono` من الفرونت dependencies (بعد التأكد).
5. إنشاء مكوّن `Button` و `Card` و `Badge` و `Input` (في `src/components/ui`).

### المرحلة 1 — المكوّنات الأساسية
6. `ToastProvider` (بديل رسائل setTimeout).
7. `ConfirmDialog` (بديل `confirm()`).
8. `Modal` (Escape + focus trap + aria).
9. `Skeleton / Spinner / EmptyState / ErrorState`.
10. `Icon` (lucide-react) + استبدال تدريجي في الصفحات الثلاث.

### المرحلة 2 — الإدماج في الصفحات
11. MissionRegistration: تحديث النموذج/المودالات بالـDesign System الجديد (الوظيفة لا تتغير).
12. AdminDashboard: تفكيك إلى مكوّنات (StatsGrid, MissionCard, CreateMissionModal, RegistrationsTable) داخل `components/`.
13. MissionControlPanel: توحيد بطاقات المعلومات + مودال تأكيد للحذف.
14. Sidebar + Header (AdminShell) — أول إضافة هيكلية.

### المرحلة 3 — الـResponsive + الـTables
15. جدول المسجلين: Pagination + Sorting + Card view على الموبايل.
16. تحسين المودالات على الموبايل.
17. Touch targets ≥ 44px.

### المرحلة 4 — الإتاحة والأداء
18. ARIA + focus trap + prefers-reduced-motion.
19. `React.lazy` للمودال الثقيل عند الحاجة.
20. تجربة يدوية شاملة (QA) لكل الصفحات.

---

## DO NOT CHANGE YET

قائمة صارمة — **لا تلمس** أثناء مرحلة إعادة تصميم الواجهة إلا بإذن صريح:

1. **كل منطق الـAPI**: `src/api/admin.ts` و `src/api/public.ts` و `src/lib/api.ts` — التواقيع وأسماء النهايات (لا تغيير في الـfetch/الـheaders/الـTypings).
2. **التوجيه الحالي**: مسارات `/m/:code`, `/admin`, `/` — الاستبدال يتم فقط بإضافة Layout من حولها، لا بتغيير المسارات.
3. **التخزين المحلي**: `rc_admin_token` + `authHeaders()` + `checkSession()` — آلية المصادقة لا تُمس.
4. **الوظائف الحساسة**:
   - التسجيل الصوتي (MediaRecorder + رفع الملف) — أي إعادة تصميم للـUI فقط، وليس للتدفق.
   - التسجيل المؤقت/التسجيل بالعضوية/Quick Profile — كل الشروط والتحقق تبقى.
   - إلغاء التسجيل + الترقية التلقائية من الانتظار — منطق الـbackend بالكامل.
   - إنشاء المهمة مع `registration_close_at: null` — **لا تغيير** (قاعدة حرجة من الـbackend).
5. **البيانات الحساسة**: لا `DROP`/`DELETE`/`TRUNCATE` في أي قاعدة بيانات.
6. **الرسائل النصية** (عبارة التأكيد، رسائل الواتساب، كود المهمة) — تبقى كما هي (مستخدَمة في التكامل الخارجي).
7. **Telegram bot / cron / Cloudflare Worker** — خارج نطاق الـUI تمامًا.
8. **الشارات الحالية** (مؤكد/انتظار/ملغي) — لا تُحذف الدلالات؛ يُعاد تصميم الشكل فقط.
9. **لا مكتبات جديدة ثقيلة** بدون إذن (لا Recharts ثقيلة، لا Framer Motion، لا إطار UI كامل مثل MUI).
10. **لا إعادة هيكلة المجلدات** الجذرية (بنية `src/api`, `src/lib`, `src/pages` ثابتة) إلا بإضافة `src/components` الجديد بس.

---

## HIGH PRIORITY UI CHANGES

مرتبة من **Priority 1** (الأهم فورًا) إلى **Priority 10**:

| الأولوية | التغيير | السبب |
|----------|---------|-------|
| **1** | حذف `user-scalable=no` + إضافة خط عربي (Cairo/Tajawal) | الإتاحة الأساسية + العربية أولًا — يؤثر على كل مستخدم |
| **2** | نظام ألوان موحّد: فصل الأحمر Primary عن الأحمر Error/Danger + tokens في `index.css` | إزالة تضارب المعاني الحالي (أخطر مشكلة بصرية) |
| **3** | مكتبة أيقونات واحدة (lucide-react) + استبدال الـEmoji | تناسق بصري فوري + تلوين دلالي |
| **4** | مكوّنات UI أساسية: `Button`, `Card`, `Badge`, `Input`, `Modal` | الأساس لكل التحسينات اللاحقة — يقلل التكرار 80% |
| **5** | Toast system + ConfirmDialog (بديل `confirm()` و setTimeout) | تحسين UX فوري للعمليات الحرجة (حذف/إغلاق) |
| **6** | Layout مشترك للأدمن: Header + Sidebar (Desktop) / Drawer (Mobile) | الهوية والتنقل — التأثير الأكبر على "الشعور الاحترافي" |
| **7** | إعادة هيكلة AdminDashboard إلى مكوّنات (`components/`) + تحسين MissionCard (شريط تقدم الامتلاء) | قابلية الصيانة + تمييز الحالات بصريًا |
| **8** | جدول المسجلين: Pagination + Sort + Card view للموبايل | قابلية الاستخدام الفعلية على الهاتف + النمو |
| **9** | حالات Empty/Loading/Error مصممة + Skeletons | احترافية الحالات غير السعيدة (لا "لا توجد تسجيلات" عارية) |
| **10** | Accessibility: ARIA labels، focus trap للمودالات، Escape، prefers-reduced-motion | الامتثال والإتاحة النهائية |

---

## ملخص سريع — أهم 10 ملاحظات

1. **3 صفحات فقط** (تسجيل + أدمن + مودال تحكم)، بدون Layout/Header/Sidebar مشترك — لا يوجد هيكل تنقل حاليًا.
2. **لا يوجد أي مكتبة أيقونات** — كل الأيقونات Emoji (مؤكد بالبحث: 0 matches لمكتبات شهيرة)، والأحجام/الأشكال غير متناسقة.
3. **لا يوجد خط عربي** — Inter لا يدعم العربية؛ كل النص العربي يقع على خط النظام الافتراضي.
4. **تكرار هائل** — لا توجد مكوّنات مشتركة (مجلد `components/` فارغ)؛ كل زر/بطاقة/إدخال مكتوب inline في 3 ملفات ضخمة (850-994 سطر).
5. **اللون الأحمر له معانٍ متضاربة** — نفس `red-600` للـPrimary والـError والـDestructive والـ"مغلق".
6. **لا Toast/Modal/Confirm موحّد** — يعتمد على `confirm()` المتصفح + رسائل setTimeout تختفي بصمت.
7. **Optimistic updates بلا إشارة نجاح حقيقية** — "تم الحفظ" تظهر فورًا حتى لو فشل الـAPI (مع rollback صامت).
8. **الجدول بلا Pagination/Sort** و على الموبايل يتحول لتمرير أفقي طويل غير قابل للاستخدام.
9. **إتاحة ضعيفة**: `user-scalable=no` يمنع التكبير، لا ARIA، لا focus trap، المودالات لا تغلق بـ Escape.
10. **`hono` (backend framework) موجود كـdependency في الفرونت** — وزن بلا فائدة؛ والبنية جاهزة للتوسع (المجلدات الفارغة + React Query + Tailwind) — **الواجهة صغيرة وسهلة التطوير إلى مستوى Professional دون إعادة بناء.**