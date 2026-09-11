/**
 * Telegram Bot — Smart AI-Powered Mission Management
 * Understands Egyptian colloquial Arabic, wizard flows, and inline buttons.
 * Uses Cloudflare Workers AI for NLU + grammY for Bot API.
 */
import { Hono } from 'hono';
import { Bot } from 'grammy';
import { InlineKeyboard } from 'grammy';

// ─── Type Declarations ─────────────────────────────────────────
interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  ADMIN_CHAT_IDS?: string;           // Comma-separated chat IDs
  AI: any;                           // Cloudflare Workers AI binding
  ENVIRONMENT?: string;
}

// ─── Wizard Session State ──────────────────────────────────────
type WizardState = 'idle'
  | 'create_title' | 'create_location' | 'create_capacity' | 'create_confirm'
  | 'delete_confirm'
  | 'toggle_confirm'
  | 'cancelreg_select_mission' | 'cancelreg_select_volunteer' | 'cancelreg_confirm'
  | 'waitlist_select_mission' | 'waitlist_select_volunteer' | 'waitlist_confirm';

interface WizardData {
  title?: string;
  location?: string;
  time?: string;
  capacity?: number;
  missionId?: string;
  missionCode?: string;
  volunteerId?: string;
  volunteerName?: string;
  registrationId?: string;
  [key: string]: unknown;
}

interface SessionRow {
  chat_id: number;
  state: WizardState;
  data: string;   // JSON
  updated_at: string;
}

// ─── AI Intent Types ───────────────────────────────────────────
type IntentType =
  | 'create_mission' | 'list_missions' | 'list_active'
  | 'stats' | 'status' | 'help'
  | 'toggle_registration' | 'close_mission' | 'delete_mission'
  | 'cancel_registration' | 'view_waitlist' | 'view_registrants'
  | 'unknown';

interface ParsedIntent {
  intent: IntentType;
  confidence: number;
  extracted: {
    title?: string;
    location?: string;
    time?: string;
    capacity?: number;
    missionCode?: string;     // e.g. "MNY-123"
    memberNumber?: string;    // e.g. "رقم عضوية 123"
    missionHint?: string;     // fuzzy name/code to search for
  };
}

// ─── Route Export ──────────────────────────────────────────────
export const telegramRoutes = new Hono<{ Bindings: Env }>();

// ─── Constants ─────────────────────────────────────────────────
const EMOJI: Record<string, string> = {
  DRAFT: '📝', OPEN: '🟢', CLOSED: '🔴', CANCELLED: '❌', COMPLETED: '✅',
};
const STATUS_AR: Record<string, string> = {
  DRAFT: 'مسودة', OPEN: 'مفتوحة', CLOSED: 'مغلقة', CANCELLED: 'ملغاة', COMPLETED: 'مكتملة',
};
const REG_STATUS_AR: Record<string, string> = {
  CONFIRMED: 'مؤكد', WAITLIST: 'قائمة انتظار', CANCELLED: 'ملغي', PENDING: 'قيد الانتظار',
};

// ─── Admin Check ───────────────────────────────────────────────
function isAuthorizedChat(chatId: number, adminChatIds?: string): boolean {
  if (!adminChatIds) return true; // First-contact mode
  const ids = adminChatIds.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
  return ids.includes(chatId);
}

// ─── D1 Session Helpers ────────────────────────────────────────
async function getSession(db: D1Database, chatId: number): Promise<{ state: WizardState; data: WizardData }> {
  const row = await db.prepare('SELECT state, data FROM telegram_sessions WHERE chat_id = ?')
    .bind(chatId).first<SessionRow>();
  if (!row) return { state: 'idle', data: {} };
  return { state: row.state as WizardState, data: JSON.parse(row.data || '{}') };
}

async function setSession(db: D1Database, chatId: number, state: WizardState, data: WizardData): Promise<void> {
  await db.prepare(
    `INSERT INTO telegram_sessions (chat_id, state, data, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET state=?, data=?, updated_at=datetime('now')`
  ).bind(chatId, state, JSON.stringify(data), state, JSON.stringify(data)).run();
}

async function clearSession(db: D1Database, chatId: number): Promise<void> {
  await setSession(db, chatId, 'idle', {});
}

// ─── Telegram API Helpers ──────────────────────────────────────
async function tgSend(token: string, chatId: number, text: string, extra?: Record<string, unknown>): Promise<void> {
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML', ...extra };
  // Normalize grammy InlineKeyboard instances into plain JSON
  if (body.reply_markup && typeof (body.reply_markup as any)?.inline_keyboard === 'function') {
    body.reply_markup = { inline_keyboard: (body.reply_markup as any).inline_keyboard() };
  } else if (body.reply_markup && typeof (body.reply_markup as any)?.toJSON === 'function') {
    body.reply_markup = (body.reply_markup as any).toJSON();
  }
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(console.error);
}

async function tgEdit(token: string, chatId: number, messageId: number, text: string, extra?: Record<string, unknown>): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra }),
  }).catch(console.error);
}

async function tgAnswerCb(token: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: !!text }),
  }).catch(console.error);
}

async function tgDeleteMessage(token: string, chatId: number, messageId: number): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/deleteMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId }),
  }).catch(() => {}); // ignore if already deleted
}

// ─── AI Intent Parser ──────────────────────────────────────────
// Falls back to rule-based parsing if AI is unavailable
async function parseIntent(
  text: string,
  ai?: any
): Promise<ParsedIntent> {
  // Try AI first if available
  if (ai) {
    try {
      const aiResult = await parseWithAI(text, ai);
      if (aiResult && aiResult.confidence > 0.5) return aiResult;
    } catch (e) {
      console.warn('AI parse failed, falling back to rules:', e);
      console.warn('AI_ERROR:', JSON.stringify(e, Object.getOwnPropertyNames(e || {})));
    }
  }
  // Fallback: rule-based Egyptian Arabic intent parsing
  return parseWithRules(text);
}

async function parseWithAI(text: string, ai: any): Promise<ParsedIntent | null> {
  const prompt = `أنت مساعد ذكي لتطبيق إدارة مهام الإسعاف.
حلل الرسالة التالية واستخرج النية والبيانات.

الرسالة: "${text}"

أجب بالـ JSON التالي فقط (بدون أي نص إضافي):
{
  "intent": "create_mission|list_missions|list_active|stats|status|help|toggle_registration|close_mission|delete_mission|cancel_registration|view_waitlist|view_registrants|unknown",
  "confidence": 0.0-1.0,
  "extracted": {
    "title": "اسم المهمة إن وُجد (نظيف بدون حروف زائدة)",
    "location": "المكان إن وُجد (بدون الوقت)",
    "time": "الوقت/الميعاد إن وُجد مثل الساعة 3 أو 15:00",
    "capacity": رقم إن وُجد,
    "missionCode": "كود المهمة MNY-XXX إن وُجد",
    "memberNumber": "رقم العضوية إن وُجد",
    "missionHint": "أي ذكر للمهمة"
  }
}

أمثلة:
- "اعمل مهمه اسمها اسعاف حادث في ديرمواس الساعه 3" → intent: create_mission, extracted: {title: "إسعاف حادث", location: "ديرمواس", time: "الساعة 3", capacity: null}
- "شوف المهمات" → intent: list_missions
- "شيل أحمد رقم عضويته 123 من مهمه MNY-379" → intent: cancel_registration, extracted: {memberNumber: "123", missionCode: "MNY-379"}
- "ابعتلي احصائيات" → intent: stats
- "امسح مهمه MNY-171" → intent: delete_mission, extracted: {missionCode: "MNY-171"}
- "فتح التسجيل في المهمه" → intent: toggle_registration
- "اجمع الانتظار" → intent: view_waitlist`;

  const result = await ai.run('@cf/meta/llama-3.1-8b-instruct-fp8', {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 512,
    temperature: 0.1,
  });

  const rawOutput = result?.response ?? '';
  console.log('AI_RAW_OUTPUT:', rawOutput.slice(0, 500));
  // Extract JSON from the response
  const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  const parsed = JSON.parse(jsonMatch[0]) as ParsedIntent;

  // ─── Post-processing: clean LLM output ───────────────────
  if (parsed.extracted) {
    // Remove stray leading "ا " or "أ " from titles (LLM artifact)
    if (parsed.extracted.title) {
      parsed.extracted.title = parsed.extracted.title.replace(/^(ا|أ)\s+/i, '').trim();
    }
    // If location still contains time, separate it
    if (parsed.extracted.location && !parsed.extracted.time) {
      const timeMatch = parsed.extracted.location.match(/(?:الساعة|الساعه|على الساعة|فى الساعة|في الساعة)\s*(\d{1,2}(?::\d{2})?\s*(?:صباحاً|مساءً|ص|م)?)/i);
      if (timeMatch) {
        parsed.extracted.time = `الساعة ${timeMatch[1].trim()}`;
        parsed.extracted.location = parsed.extracted.location.replace(/(?:،|\s)+(?:الساعة|الساعه|على الساعة|فى الساعة|في الساعة)\s*\d{1,2}(?::\d{2})?\s*(?:صباحاً|مساءً|ص|م)?/i, '').trim();
      }
    }
  }
  return parsed;
}

function parseWithRules(text: string): ParsedIntent {
  const t = text.trim().toLowerCase();
  const extracted: ParsedIntent['extracted'] = {};

  // Extract MNY-XXX codes
  const codeMatch = text.match(/MNY-?(\d+)/i);
  if (codeMatch) extracted.missionCode = `MNY-${codeMatch[1]}`;

  // Extract member numbers
  const memberMatch = text.match(/(?:رقم\s*عضوية?\s*|عضوية\s*|auf\s*|num\s*)(\d+)/i)
    || text.match(/(\d{4,})/);  // 4+ digit number likely a member ID
  if (memberMatch) extracted.memberNumber = memberMatch[1];

  // Extract capacity
  const capMatch = text.match(/(?:عدد|سِعه|سعة|capacity| Handasa\s*)(\d+)/i)
    || text.match(/(\d+)\s*(?:شخص|فرد| volunt)/i);
  if (capMatch) extracted.capacity = parseInt(capMatch[1]);

  // ─── Intent classification (Egyptian Arabic patterns) ────
  // Create mission patterns
  if (/(?:اعمل|عمل|انشئ|انشاء|اقرأ|فتح|ابدأ|اصنع|سجّل|سجفل)\s*(?:مهم[ةه]|مهمت)/.test(t)
    || /مهم[ةه]\s*جديدة/.test(t)
    || /(?:create|new)\s*mission/.test(t)) {
    extracted.missionHint = text;
    // Try to extract title from the message
    const titleMatch = text.match(/(?:اسم(?:ها|ه)?\s*|عنوان[هاه]?\s*[:：]?\s*)(.+?)(?:\s+في\s|\s+ب\s|\s+capacity|\s+عدد|$)/i)
      || text.match(/مهم[ةه]\s*(?:اسم(?:ها|ه)?\s*)?[:：]?\s*(.+?)(?:\s+في\s|\s+ب\s|\s+عدد|$)/i);
    if (titleMatch) {
      let rawTitle = titleMatch[1].trim();
      // Cleanup: strip stray leading "ا " / "أ " (regex/LLM artifact)
      rawTitle = rawTitle.replace(/^(ا|أ)\s+/i, '').trim();
      // Discard generic placeholders like "جديدة" / "new" — not a real title
      if (!/^(جديدة?|new|جديد|مهمة|مهمه|واحدة|واحد|عمل)$/i.test(rawTitle)) {
        extracted.title = rawTitle;
      }
    }
    const locMatch = text.match(/(?:في|بـ|ب|at|in)\s+(.+?)(?:\s+عدد|\s+capacity|$)/i);
    if (locMatch) extracted.location = locMatch[1].trim();
    return { intent: 'create_mission', confidence: 0.9, extracted };
  }

  // List missions
  if (/(?:شوف|عرض|اوريك|وريني|.List|all\s*mission)/.test(t)
    || /مهم[ةه]ت?ي?ن?\s*(?:models|كل|الكل)/.test(t)) {
    if (/(?:نشيطة|-active|current|الحالية)/.test(t)) {
      return { intent: 'list_active', confidence: 0.9, extracted };
    }
    return { intent: 'list_missions', confidence: 0.9, extracted };
  }

  // Stats
  if (/(?:احصائيات|statistics|stats|إحصاء|تقرير)/.test(t)) {
    return { intent: 'stats', confidence: 0.9, extracted };
  }

  // Status
  if (/(?:حالة|status|الحالة|bot\s*status)/.test(t)) {
    return { intent: 'status', confidence: 0.9, extracted };
  }

  // Help
  if (/(?:مساعدة|help|guid|tutorial|ازاي|usage)/.test(t)) {
    return { intent: 'help', confidence: 0.95, extracted };
  }

  // Delete mission
  if (/(?:امسح|حذف|شيل|askh|remove|delete)\s*(?:مهم[ةه]|mission)/.test(t)
    || /حذف\s*(?:مهم[ةه])/.test(t)) {
    return { intent: 'delete_mission', confidence: 0.9, extracted };
  }

  // Close mission
  if (/(?:اقفل|غلق|close|stop)\s*(?:مهم[ةه]|registration|التسجيل)/.test(t)
    || /(?:اقفال|إغلاق)\s*(?:التسجيل|registration)/.test(t)) {
    return { intent: 'close_mission', confidence: 0.85, extracted };
  }

  // Toggle registration
  if (/(?:فتح|فتح|toggle|open|ابق)|\s*(?:التسجيل|registration|مهم[ةه])/.test(t)) {
    if (/(?:قفل|غلق|close|stop|toggle|افتح|اقفل)/.test(t)) {
      return { intent: 'toggle_registration', confidence: 0.85, extracted };
    }
  }

  // Cancel registration
  if (/(?:شيل|الغي|الغاء|الغِ|cancel|حذف\s*تسجيل)/.test(t)
    && (/(?:متطوع|volunteer|عضو|asha3|تسجيل|vol)/.test(t) || extracted.memberNumber)) {
    return { intent: 'cancel_registration', confidence: 0.9, extracted };
  }

  // View waitlist
  if (/(?:انتظار|waitlist|waiting|الانتظار|قائمه\s*الانتظار)/.test(t)) {
    return { intent: 'view_waitlist', confidence: 0.85, extracted };
  }

  // View registrants
  if (/(?:متطوعين|المسجلين|registered|volunteers|تسجيلات|المشاركين)/.test(t)) {
    return { intent: 'view_registrants', confidence: 0.85, extracted };
  }

  // Toggle registration (fallback)
  if (/(?:فتح|فتح|-toggle|open)\s*(?:التسجيل|registration|مهم[ةه])/.test(t)) {
    return { intent: 'toggle_registration', confidence: 0.8, extracted };
  }

  return { intent: 'unknown', confidence: 0.2, extracted };
}

// ─── DB Query Helpers ──────────────────────────────────────────
async function findMissionByHint(db: D1Database, hint: string): Promise<any | null> {
  // Try exact code match first (MNY-XXX)
  const code = hint.match(/MNY-?(\d+)/i);
  if (code) {
    const row = await db.prepare(
      'SELECT id, public_code, title, status FROM missions WHERE public_code = ?'
    ).bind(`MNY-${code[1]}`).first();
    if (row) return row;
  }
  // Try LIKE search on title or code
  const rows = await db.prepare(
    `SELECT id, public_code, title, status FROM missions
     WHERE public_code LIKE ? OR title LIKE ?
     ORDER BY created_at DESC LIMIT 1`
  ).bind(`%${hint}%`, `%${hint}%`).all();
  return rows.results?.[0] || null;
}

async function findVolunteerByMemberId(db: D1Database, memberId: string): Promise<any | null> {
  return await db.prepare(
    'SELECT id, name, member_id FROM volunteers WHERE member_id = ?'
  ).bind(memberId).first() || null;
}

async function findRegistration(db: D1Database, missionId: string, volunteerId: string): Promise<any | null> {
  return await db.prepare(
    `SELECT r.id, r.status, v.name as volunteer_name, v.member_id
     FROM registrations r JOIN volunteers v ON r.volunteer_id = v.id
     WHERE r.mission_id = ? AND r.volunteer_id = ? AND r.status != 'CANCELLED'`
  ).bind(missionId, volunteerId).first() || null;
}

// ─── Inline Keyboard Builders ──────────────────────────────────
function mainMenuKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('📋 كل المهمات', 'list:all')
    .text('🟢 النشطة فقط', 'list:active')
    .row();
  kb.text('➕ مهمة جديدة', 'create:start')
    .text('📊 إحصائيات', 'stats:show')
    .row();
  kb.text('❓ مساعدة', 'help:show')
    .text('🤖 حالة البوت', 'bot:status');
  return kb;
}

function missionActionsKeyboard(missionId: string, missionCode: string, status: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (status === 'DRAFT') {
    kb.text('🟢 فتح التسجيل', `toggle:${missionId}`);
  } else if (status === 'OPEN') {
    kb.text('🔴 إغلاق التسجيل', `toggle:${missionId}`);
  } else if (status === 'CLOSED') {
    kb.text('🟢 إعادة الفتح', `toggle:${missionId}`);
  }
  kb.row();
  kb.text('👥 المسجلين', `registrants:${missionId}`)
    .text('⏳ قائمة الانتظار', `waitlist:${missionId}`)
    .row();
  kb.text('🗑️ حذف المهمة', `delete:${missionId}`)
    .text('🔙 القائمة الرئيسية', 'menu:main');
  return kb;
}

function confirmKeyboard(action: string, id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ نعم، تأكيد', `confirm:${action}:${id}`)
    .text('❌ إلغاء', 'cancel:action');
}

// ─── Wizard Flow: Create Mission ───────────────────────────────
async function startCreateWizard(token: string, chatId: number, db: D1Database, initialData?: Partial<WizardData>): Promise<void> {
  await setSession(db, chatId, 'create_title', { ...initialData });
  const titleHint = initialData?.title ? `\n(الاسم المستخرج: <b>${initialData.title}</b>)` : '';
  await tgSend(token, chatId,
    `➕ <b>إنشاء مهمة جديدة</b>\n\n`
    + `📍 الخطوة 1 من 3: اكتب اسم المهمة${titleHint}\n\n`
    + `💡 مثال: إسعاف حادث — حملة تطعيم — تطوير مقر`,
    { reply_markup: new InlineKeyboard().text('❌ إلغاء', 'cancel:wizard') }
  );
}

async function wizardCreateTitle(token: string, chatId: number, db: D1Database, title: string, data: WizardData): Promise<void> {
  data.title = title;
  await setSession(db, chatId, 'create_location', data);
  await tgSend(token, chatId,
    `✅ الاسم: <b>${title}</b>\n\n`
    + `📍 الخطوة 2 من 3: اكتب المقر أو العنوان\n\n`
    + `💡 مثال: مبنى إدارة الإسعاف — المنيا العامة — ديرمواس`
  );
}

async function wizardCreateLocation(token: string, chatId: number, db: D1Database, location: string, data: WizardData): Promise<void> {
  data.location = location;
  await setSession(db, chatId, 'create_capacity', data);
  await tgSend(token, chatId,
    `✅ المقر: <b>${location}</b>\n\n`
    + `👥 الخطوة 3 من 3: كم متطوع مطلوب؟ (اتركه فاضي لو بدون حد أقصى)`
  );
}

async function wizardCreateConfirm(token: string, chatId: number, db: D1Database, capacityText: string, data: WizardData): Promise<void> {
  const trimmed = capacityText.trim();
  // Allow empty (no max) or a positive number; otherwise re-ask
  if (trimmed !== '' && (!/^\d+$/.test(trimmed) || parseInt(trimmed) < 1)) {
    await tgSend(token, chatId,
      `⚠️ اكتب رقم صحيح للمتطوعين (مثلاً: 20)، أو اتركه فاضي لو من غير حد أقصى.\n\n`
      + `👥 كم متطوع مطلوب؟`
    );
    return;
  }
  data.capacity = trimmed === '' ? 0 : parseInt(trimmed);
  await setSession(db, chatId, 'create_confirm', data);
  const capText = data.capacity > 0 ? `${data.capacity} متطوع` : 'بدون حد أقصى';

  const kb = new InlineKeyboard()
    .text('✅ إنشاء المهمة', 'confirm:create')
    .text('✏️ تعديل', 'create:start')
    .text('❌ إلغاء', 'cancel:wizard');

  await tgSend(token, chatId,
    `📋 <b>ملخص المهمة:</b>\n\n`
    + `📝 <b>الاسم:</b> ${data.title}\n`
    + `📍 <b>المقر:</b> ${data.location}${data.time ? `\n⏰ <b>الميعاد:</b> ${data.time}` : ''}\n`
    + `👥 <b>العدد:</b> ${capText}\n\n`
    + `هل تريد إنشاء المهمة؟`,
    { reply_markup: kb }
  );
}

async function executeCreateMission(token: string, chatId: number, db: D1Database, data: WizardData): Promise<void> {
  // Generate unique code
  let code = '';
  let attempts = 0;
  do {
    const rand = Math.floor(100 + Math.random() * 900);
    code = `MNY-${rand}`;
    const exists = await db.prepare('SELECT id FROM missions WHERE public_code = ?').bind(code).first();
    if (!exists) break;
    attempts++;
  } while (attempts < 10);
  if (!code) code = `MNY-${Date.now() % 1000}`;

  const capacity = data.capacity || 0;
  await db.prepare(
    `INSERT INTO missions (id, public_code, title, description, location, capacity, status, confirmation_phrase, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, datetime('now'), datetime('now'))`
  ).bind(
    crypto.randomUUID(), code, data.title || 'مهمة بدون عنوان',
    '', data.location || 'غير محدد', capacity,
    `${data.title} — ${data.location}`
  ).run();

  await clearSession(db, chatId);

  const kb = missionActionsKeyboard(code, code, 'DRAFT');
  await tgSend(token, chatId,
    `✅ <b>تم إنشاء المهمة بنجاح!</b>\n\n`
    + `📝 <b>الاسم:</b> ${data.title}\n`
    + `📍 <b>المقر:</b> ${data.location}\n`
    + `👥 <b>العدد:</b> ${capacity > 0 ? capacity : 'بدون حد أقصى'}\n`
    + `🔗 <b>كود التسجيل:</b> ${code}\n`
    + `📊 <b>الحالة:</b> مسودة\n\n`
    + `💡 افتح التسجيل من الأزرار بالأسفل 👇`,
    { reply_markup: kb }
  );
}

// ─── Wizard Flow: Cancel Registration ──────────────────────────
async function startCancelWizard(token: string, chatId: number, db: D1Database, data?: Partial<WizardData>): Promise<void> {
  // Load active missions
  const rows = await db.prepare(
    "SELECT id, public_code, title FROM missions WHERE status IN ('OPEN','CLOSED','DRAFT') ORDER BY created_at DESC LIMIT 10"
  ).all();

  if (!rows.results?.length) {
    await tgSend(token, chatId, '📋 لا توجد مهمات حالية.');
    return;
  }

  const kb = new InlineKeyboard();
  for (const m of rows.results) {
    kb.text(`${m.public_code} — ${m.title}`, `cancelreg:mission:${m.id}`).row();
  }
  kb.text('❌ إلغاء', 'cancel:action');

  await setSession(db, chatId, 'cancelreg_select_mission', data || {});
  await tgSend(token, chatId,
    `🗑️ <b>إلغاء تسجيل متطوع</b>\n\n`
    + `اختر المهمة:`,
    { reply_markup: kb }
  );
}

async function startCancelVolunteerSelect(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  const mission = await db.prepare('SELECT id, public_code, title FROM missions WHERE id = ?').bind(missionId).first();
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }

  const rows = await db.prepare(
    `SELECT r.id as reg_id, r.status, v.name, v.member_id
     FROM registrations r JOIN volunteers v ON r.volunteer_id = v.id
     WHERE r.mission_id = ? AND r.status != 'CANCELLED'
     ORDER BY r.created_at`
  ).bind(missionId).all();

  if (!rows.results?.length) {
    await tgSend(token, chatId, `📋 لا يوجد مسجلين في <b>${mission.title}</b>`);
    await clearSession(db, chatId);
    return;
  }

  const kb = new InlineKeyboard();
  for (const r of rows.results) {
    const statusIcon = r.status === 'CONFIRMED' ? '✅' : '⏳';
    kb.text(`${statusIcon} ${r.name} (${r.member_id})`, `cancelreg:vol:${r.reg_id}`).row();
  }
  kb.text('❌ إلغاء', 'cancel:action');

  const data: WizardData = { missionId, missionCode: mission.public_code as string };
  await setSession(db, chatId, 'cancelreg_select_volunteer', data);
  await tgSend(token, chatId,
    `👥 <b>مسجلو ${mission.title} (${mission.public_code})</b>\n\n`
    + `اختر المتطوع لإلغاء تسجيله:`,
    { reply_markup: kb }
  );
}

async function confirmCancelRegistration(token: string, chatId: number, db: D1Database, regId: string): Promise<void> {
  const reg = await db.prepare(
    `SELECT r.id, v.name, v.member_id, m.title, m.public_code
     FROM registrations r JOIN volunteers v ON r.volunteer_id = v.id JOIN missions m ON r.mission_id = m.id
     WHERE r.id = ?`
  ).bind(regId).first() as any;

  if (!reg) { await tgSend(token, chatId, '❌ التسجيل غير موجود.'); return; }

  const data: WizardData = { registrationId: regId, volunteerName: reg.name, missionCode: reg.public_code };
  await setSession(db, chatId, 'cancelreg_confirm', data);

  await tgSend(token, chatId,
    `⚠️ <b>تأكيد إلغاء التسجيل</b>\n\n`
    + `👤 <b>المتطوع:</b> ${reg.name} (${reg.member_id})\n`
    + `📋 <b>المهمة:</b> ${reg.title} (${reg.public_code})\n\n`
    + `هل تريد تأكيد الإلغاء؟`,
    { reply_markup: confirmKeyboard('cancelreg', regId) }
  );
}

async function executeCancelRegistration(token: string, chatId: number, db: D1Database, regId: string): Promise<void> {
  const reg = await db.prepare(
    `SELECT r.id, v.name, v.member_id, m.title
     FROM registrations r JOIN volunteers v ON r.volunteer_id = v.id JOIN missions m ON r.mission_id = m.id
     WHERE r.id = ?`
  ).bind(regId).first() as any;

  await db.prepare(
    `UPDATE registrations SET status = 'CANCELLED', cancelled_at = datetime('now') WHERE id = ?`
  ).bind(regId).run();

  await clearSession(db, chatId);

  // Move first waitlisted to confirmed if exists
  if (reg) {
    const next = await db.prepare(
      `SELECT id FROM registrations WHERE mission_id = (SELECT mission_id FROM registrations WHERE id = ?) AND status = 'WAITLIST' ORDER BY waitlist_position LIMIT 1`
    ).bind(regId).first() as any;
    if (next) {
      await db.prepare(`UPDATE registrations SET status = 'CONFIRMED', confirmed_at = datetime('now') WHERE id = ?`).bind(next.id).run();
    }
  }

  const kb = new InlineKeyboard()
    .text('🔙 القائمة الرئيسية', 'menu:main')
    .text('🗑️ إلغاء آخر', 'cancelreg:start');

  await tgSend(token, chatId,
    `✅ <b>تم إلغاء التسجيل بنجاح!</b>\n\n`
    + `👤 المتطوع: ${reg?.name} (${reg?.member_id})\n`
    + `📋 المهمة: ${reg?.title}`,
    { reply_markup: kb }
  );
}

// ─── Direct Cancel by member number (AI-powered) ───────────────
async function executeCancelByMember(token: string, chatId: number, db: D1Database, memberNumber: string, missionHint?: string): Promise<boolean> {
  // Find the volunteer by member number
  const vol = await db.prepare(
    `SELECT id, name, member_id FROM volunteers WHERE member_id = ?`
  ).bind(memberNumber).first() as any;
  if (!vol) return false;

  // Build mission filter: specific mission or latest active
  let missionId: string | null = null;
  if (missionHint) {
    const mission = await findMissionByHint(db, missionHint);
    if (mission) missionId = mission.id;
  }
  if (!missionId) {
    const mission = await db.prepare(
      `SELECT m.id FROM missions m
       JOIN registrations r ON r.mission_id = m.id
       WHERE r.volunteer_id = ? AND r.status != 'CANCELLED'
       ORDER BY r.created_at DESC LIMIT 1`
    ).bind(vol.id).first() as any;
    if (mission) missionId = mission.id;
  }

  if (!missionId) {
    await tgSend(token, chatId, `ℹ️ المتطوع <b>${vol.name}</b> (${memberNumber}) مش مسجل في أي مهمة حاليًا.`);
    return true;
  }

  // Find the registration
  const reg = await db.prepare(
    `SELECT r.id FROM registrations r
     WHERE r.mission_id = ? AND r.volunteer_id = ? AND r.status != 'CANCELLED'
     ORDER BY r.created_at DESC LIMIT 1`
  ).bind(missionId, vol.id).first() as any;

  if (!reg) {
    await tgSend(token, chatId, `ℹ️ المتطوع <b>${vol.name}</b> (${memberNumber}) مش مسجل في المهمة دي.`);
    return true;
  }

  await executeCancelRegistration(token, chatId, db, reg.id);
  return true;
}

// ─── Toggle Registration Flow ──────────────────────────────────
async function startToggleWizard(token: string, chatId: number, db: D1Database): Promise<void> {
  const rows = await db.prepare(
    "SELECT id, public_code, title, status FROM missions WHERE status IN ('OPEN','CLOSED','DRAFT') ORDER BY created_at DESC LIMIT 10"
  ).all();

  if (!rows.results?.length) {
    await tgSend(token, chatId, '📋 لا توجد مهمات.');
    return;
  }

  const kb = new InlineKeyboard();
  for (const m of rows.results) {
    const icon = m.status === 'OPEN' ? '🟢' : m.status === 'CLOSED' ? '🔴' : '📝';
    kb.text(`${icon} ${m.public_code} — ${m.title}`, `toggle:${m.id}`).row();
  }
  kb.text('❌ إلغاء', 'cancel:action');

  await tgSend(token, chatId,
    `🔄 <b>فتح/قفل التسجيل</b>\n\nاختر المهمة:`,
    { reply_markup: kb }
  );
}

async function executeToggle(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  const mission = await db.prepare('SELECT id, public_code, title, status FROM missions WHERE id = ?').bind(missionId).first() as any;
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }

  let newStatus: string;
  if (mission.status === 'OPEN') {
    newStatus = 'CLOSED';
  } else {
    newStatus = 'OPEN';
  }

  const timestampField = newStatus === 'OPEN' ? 'registration_open_at' : 'registration_close_at';
  await db.prepare(
    `UPDATE missions SET status = ?, ${timestampField} = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(newStatus, missionId).run();

  const icon = newStatus === 'OPEN' ? '🟢' : '🔴';
  const kb = missionActionsKeyboard(missionId, mission.public_code, newStatus);

  await tgSend(token, chatId,
    `${icon} <b>تم ${newStatus === 'OPEN' ? 'فتح' : 'إغلاق'} التسجيل!</b>\n\n`
    + `📋 <b>${mission.title}</b> (${mission.public_code})\n`
    + `📊 الحالة الجديدة: <b>${STATUS_AR[newStatus]}</b>`,
    { reply_markup: kb }
  );
}

// ─── Delete Mission Flow ───────────────────────────────────────
async function startDeleteWizard(token: string, chatId: number, db: D1Database, hint?: string): Promise<void> {
  let mission: any = null;
  if (hint) mission = await findMissionByHint(db, hint);

  if (!mission) {
    // Show list to pick from
    const rows = await db.prepare(
      "SELECT id, public_code, title, status FROM missions ORDER BY created_at DESC LIMIT 10"
    ).all();
    if (!rows.results?.length) {
      await tgSend(token, chatId, '📋 لا توجد مهمات لحذفها.');
      return;
    }
    const kb = new InlineKeyboard();
    for (const m of rows.results) {
      kb.text(`🗑️ ${m.public_code} — ${m.title}`, `delete:${m.id}`).row();
    }
    kb.text('❌ إلغاء', 'cancel:action');
    await tgSend(token, chatId, '🗑️ <b>اختر المهمة لحذفها:</b>', { reply_markup: kb });
    return;
  }

  await setSession(db, chatId, 'delete_confirm', { missionId: mission.id, missionCode: mission.public_code, title: mission.title });
  await tgSend(token, chatId,
    `⚠️ <b>تأكيد حذف المهمة</b>\n\n`
    + `📋 <b>${mission.title}</b> (${mission.public_code})\n`
    + `📊 الحالة: ${STATUS_AR[mission.status] || mission.status}\n\n`
    + `⚠️ <b>سيتم حذف جميع التسجيلات المرتبطة!</b>\n\nهل أنت متأكد؟`,
    { reply_markup: confirmKeyboard('delete', mission.id) }
  );
}

async function executeDelete(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  const mission = await db.prepare('SELECT id, public_code, title FROM missions WHERE id = ?').bind(missionId).first() as any;
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }

  // Delete registrations first, then the mission
  await db.prepare('DELETE FROM registrations WHERE mission_id = ?').bind(missionId).run();
  await db.prepare('DELETE FROM missions WHERE id = ?').bind(missionId).run();

  await clearSession(db, chatId);

  const kb = new InlineKeyboard()
    .text('🔙 القائمة الرئيسية', 'menu:main')
    .text('📋 كل المهمات', 'list:all');

  await tgSend(token, chatId,
    `✅ <b>تم حذف المهمة!</b>\n\n`
    + `🗑️ <b>${mission.title}</b> (${mission.public_code})`,
    { reply_markup: kb }
  );
}

// ─── View Helpers ──────────────────────────────────────────────
async function showMissions(token: string, chatId: number, db: D1Database, filter?: string): Promise<void> {
  let sql = 'SELECT id, public_code, title, status, capacity FROM missions';
  if (filter === 'active') sql += " WHERE status = 'OPEN'";
  sql += ' ORDER BY created_at DESC LIMIT 15';

  const rows = await db.prepare(sql).all();
  if (!rows.results?.length) {
    await tgSend(token, chatId,
      filter === 'active' ? '🟢 لا توجد مهمات نشطة حالياً.' : '📋 لا توجد مهمات.',
      { reply_markup: new InlineKeyboard().text('➕ مهمة جديدة', 'create:start') }
    );
    return;
  }

  const missions = rows.results as Array<{ status: string; title: string; public_code: string; capacity?: number | null; id: string }>;
  let msg = filter === 'active' ? '🟢 <b>المهمات النشطة:</b>\n\n' : '📋 <b>كل المهمات:</b>\n\n';
  for (const m of missions) {
    msg += `${EMOJI[m.status] || '❓'} <b>${m.title}</b> (${m.public_code})\n`;
    msg += `   📊 ${STATUS_AR[m.status] || m.status}`;
    if (m.capacity) msg += ` | 👥 ${m.capacity}`;
    msg += '\n\n';
  }

  const kb = new InlineKeyboard();
  for (const m of missions) {
    kb.text(`${m.public_code} — ${m.title}`, `mission:${m.id}`).row();
  }
  kb.text('➕ مهمة جديدة', 'create:start')
    .text('🔙 القائمة', 'menu:main');

  await tgSend(token, chatId, msg, { reply_markup: kb });
}

async function showMissionDetail(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  const m = await db.prepare(
    'SELECT id, public_code, title, description, location, capacity, status FROM missions WHERE id = ?'
  ).bind(missionId).first() as any;
  if (!m) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }

  // Get registration counts
  const confirmed = await db.prepare(
    "SELECT COUNT(*) as c FROM registrations WHERE mission_id = ? AND status = 'CONFIRMED'"
  ).bind(missionId).first() as any;
  const waitlisted = await db.prepare(
    "SELECT COUNT(*) as c FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'"
  ).bind(missionId).first() as any;

  const kb = missionActionsKeyboard(m.id, m.public_code, m.status);
  const capText = m.capacity ? `${m.capacity} متطوع` : 'بدون حد أقصى';

  await tgSend(token, chatId,
    `${EMOJI[m.status] || '❓'} <b>${m.title}</b>\n`
    + `━━━━━━━━━━━━━━━━━\n`
    + `🔗 <b>الكود:</b> ${m.public_code}\n`
    + `📍 <b>المقر:</b> ${m.location || 'غير محدد'}\n`
    + `👥 <b>العدد:</b> ${capText}\n`
    + `📊 <b>الحالة:</b> ${STATUS_AR[m.status] || m.status}\n`
    + `✅ <b>مؤكد:</b> ${confirmed?.c ?? 0}\n`
    + `⏳ <b>قائمة الانتظار:</b> ${waitlisted?.c ?? 0}`,
    { reply_markup: kb }
  );
}

async function showStats(token: string, chatId: number, db: D1Database, hint?: string): Promise<void> {
  let mission: any = null;
  if (hint) mission = await findMissionByHint(db, hint);

  if (!mission) {
    // Global stats
    const total = await db.prepare('SELECT COUNT(*) as c FROM missions').first() as any;
    const open = await db.prepare("SELECT COUNT(*) as c FROM missions WHERE status = 'OPEN'").first() as any;
    const regs = await db.prepare('SELECT COUNT(*) as c FROM registrations').first() as any;
    const confirmed = await db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'CONFIRMED'").first() as any;
    const cancelled = await db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'CANCELLED'").first() as any;
    const volunteers = await db.prepare('SELECT COUNT(DISTINCT volunteer_id) as c FROM registrations').first() as any;

    const kb = new InlineKeyboard().text('🔙 القائمة', 'menu:main');
    await tgSend(token, chatId,
      `📊 <b>إحصائيات النظام العامة</b>\n`
      + `━━━━━━━━━━━━━━━━━\n`
      + `📋 <b>المهمات:</b> ${total?.c ?? 0} (نشطة: ${open?.c ?? 0})\n`
      + `📝 <b>التسجيلات:</b> ${regs?.c ?? 0}\n`
      + `✅ <b>مؤكدة:</b> ${confirmed?.c ?? 0}\n`
      + `❌ <b>ملغاة:</b> ${cancelled?.c ?? 0}\n`
      + `👤 <b>متطوعين فريد:</b> ${volunteers?.c ?? 0}`,
      { reply_markup: kb }
    );
    return;
  }

  // Mission-specific stats
  const regs = await db.prepare(
    'SELECT COUNT(*) as c FROM registrations WHERE mission_id = ?'
  ).bind(mission.id).first() as any;
  const confirmed = await db.prepare(
    "SELECT COUNT(*) as c FROM registrations WHERE mission_id = ? AND status = 'CONFIRMED'"
  ).bind(mission.id).first() as any;
  const waitlisted = await db.prepare(
    "SELECT COUNT(*) as c FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'"
  ).bind(mission.id).first() as any;
  const cancelled = await db.prepare(
    "SELECT COUNT(*) as c FROM registrations WHERE mission_id = ? AND status = 'CANCELLED'"
  ).bind(mission.id).first() as any;

  const kb = missionActionsKeyboard(mission.id, mission.public_code, mission.status);
  await tgSend(token, chatId,
    `📊 <b>إحصائيات: ${mission.title}</b> (${mission.public_code})\n`
    + `━━━━━━━━━━━━━━━━━\n`
    + `📝 <b>إجمالي التسجيلات:</b> ${regs?.c ?? 0}\n`
    + `✅ <b>مؤكدة:</b> ${confirmed?.c ?? 0}\n`
    + `⏳ <b>قائمة الانتظار:</b> ${waitlisted?.c ?? 0}\n`
    + `❌ <b>ملغاة:</b> ${cancelled?.c ?? 0}`,
    { reply_markup: kb }
  );
}

async function showRegistrants(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  const mission = await db.prepare('SELECT id, public_code, title FROM missions WHERE id = ?').bind(missionId).first() as any;
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }

  const rows = await db.prepare(
    `SELECT r.status, r.waitlist_position, v.name, v.member_id
     FROM registrations r JOIN volunteers v ON r.volunteer_id = v.id
     WHERE r.mission_id = ? AND r.status != 'CANCELLED'
     ORDER BY r.status, r.created_at`
  ).bind(missionId).all();

  if (!rows.results?.length) {
    await tgSend(token, chatId, `📋 لا يوجد مسجلين في <b>${mission.title}</b>`);
    return;
  }

  let msg = `👥 <b>مسجلو ${mission.title} (${mission.public_code})</b>\n━━━━━━━━━━━━━━━━━\n\n`;

  const confirmed = rows.results.filter((r: any) => r.status === 'CONFIRMED');
  const waitlist = rows.results.filter((r: any) => r.status === 'WAITLIST');

  if (confirmed.length) {
    msg += `✅ <b>مؤكدون (${confirmed.length}):</b>\n`;
    confirmed.forEach((r: any, i: number) => {
      msg += `  ${i + 1}. ${r.name} — ${r.member_id}\n`;
    });
    msg += '\n';
  }
  if (waitlist.length) {
    msg += `⏳ <b>قائمة الانتظار (${waitlist.length}):</b>\n`;
    waitlist.forEach((r: any) => {
      msg += `  #${r.waitlist_position || '?'} — ${r.name} — ${r.member_id}\n`;
    });
  }

  const kb = missionActionsKeyboard(mission.id, mission.public_code, 'OPEN');
  await tgSend(token, chatId, msg, { reply_markup: kb });
}

async function showWaitlist(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  const mission = await db.prepare('SELECT id, public_code, title FROM missions WHERE id = ?').bind(missionId).first() as any;
  if (!mission) { await tgSend(token, chatId, '❌ المهمة غير موجودة.'); return; }

  const rows = await db.prepare(
    `SELECT r.waitlist_position, v.name, v.member_id
     FROM registrations r JOIN volunteers v ON r.volunteer_id = v.id
     WHERE r.mission_id = ? AND r.status = 'WAITLIST'
     ORDER BY r.waitlist_position`
  ).bind(missionId).all();

  if (!rows.results?.length) {
    await tgSend(token, chatId, `⏳ لا يوجد أحد في قائمة الانتظار لـ <b>${mission.title}</b>`);
    return;
  }

  let msg = `⏳ <b>قائمة الانتظار — ${mission.title}</b>\n━━━━━━━━━━━━━━━━━\n\n`;
  rows.results.forEach((r: any) => {
    msg += `#${r.waitlist_position || '?'} — ${r.name} — ${r.member_id}\n`;
  });

  const kb = missionActionsKeyboard(mission.id, mission.public_code, 'OPEN');
  await tgSend(token, chatId, msg, { reply_markup: kb });
}

// ─── Help Message ──────────────────────────────────────────────
function helpText(): string {
  return `🤖 <b>مرحباً! أنا مساعد إدارة المهام الذكي</b>\n━━━━━━━━━━━━━━━━━\n\n`
    + `💡 اكتب بالعربي العادي وأنا هفهمك!\n\n`
    + `<b>🎯 أوامر سريعة:</b>\n\n`
    + `📝 <b>إنشاء مهمة:</b>\n`
    + `  اكتب أي حاجة زي:\n`
    + `  • "اعمل مهمه اسمها إسعاف حادث"\n`
    + `  • "مهمة جديدة"\n`
    + `  • "انشأ حملة في ديرمواس"\n\n`
    + `📋 <b>عرض المهمات:</b>\n`
    + `  • "شوف المهمات" أو "المهمات"\n`
    + `  • "المهمات النشطة"\n\n`
    + `📊 <b>إحصائيات:</b>\n`
    + `  • "إحصائيات" أو "تقرير"\n`
    + `  • "احصائيات مهمه MNY-379"\n\n`
    + `🔄 <b>فتح/قفل التسجيل:</b>\n`
    + `  • "فتح التسجيل" أو "اقفل التسجيل"\n\n`
    + `🗑️ <b>حذف مهمة:</b>\n`
    + `  • "امسح مهمه MNY-379"\n\n`
    + `❌ <b>إلغاء تسجيل متطوع:</b>\n`
    + `  • "شيل متطوع برقم عضوية 123"\n\n`
    + `⏳ <b>قائمة الانتظار:</b>\n`
    + `  • "انتظار مهمه MNY-379"\n\n`
    + `👥 <b>المسجلين:</b>\n`
    + `  • "المتطوعين في مهمه MNY-379"\n\n`
    + `━━━━━━━━━━━━━━━━━\n`
    + `💡 أو استخدم الأزرار بالأسفل 👇`;
}

// ─── Wizard Message Handler ────────────────────────────────────
async function handleWizardMessage(
  token: string, chatId: number, db: D1Database, text: string, session: { state: WizardState; data: WizardData }
): Promise<boolean> {
  switch (session.state) {
    case 'create_title': {
      // If no title hint, accept as-is
      await wizardCreateTitle(token, chatId, db, text, session.data);
      return true;
    }
    case 'create_location': {
      await wizardCreateLocation(token, chatId, db, text, session.data);
      return true;
    }
    case 'create_capacity': {
      await wizardCreateConfirm(token, chatId, db, text, session.data);
      return true;
    }
    default:
      return false; // Not in a wizard, continue to AI parse
  }
}

// ─── Callback Query Handler ────────────────────────────────────
async function handleCallbackQuery(token: string, chatId: number, db: D1Database, callbackQuery: any): Promise<void> {
  const data: string = callbackQuery.data;
  const cqId: string = callbackQuery.id;
  const msgId: number = callbackQuery.message?.message_id;

  if (!data) return;

  const [action, ...params] = data.split(':');

  switch (action) {
    // ─── Main menu ───
    case 'menu': {
      await tgAnswerCb(token, cqId);
      await tgSend(token, chatId, '🏠 <b>القائمة الرئيسية:</b>', { reply_markup: mainMenuKeyboard() });
      return;
    }

    // ─── List ───
    case 'list': {
      await tgAnswerCb(token, cqId);
      await showMissions(token, chatId, db, params[0]);
      return;
    }

    // ─── Stats ───
    case 'stats': {
      await tgAnswerCb(token, cqId);
      await showStats(token, chatId, db);
      return;
    }

    // ─── Help ───
    case 'help': {
      await tgAnswerCb(token, cqId);
      await tgSend(token, chatId, helpText(), { reply_markup: mainMenuKeyboard() });
      return;
    }

    // ─── Bot status ───
    case 'bot': {
      await tgAnswerCb(token, cqId);
      const missionRow = await db.prepare('SELECT COUNT(*) as c FROM missions').first() as any;
      const regRow = await db.prepare('SELECT COUNT(*) as c FROM registrations').first() as any;
      const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
      await tgSend(token, chatId,
        `🤖 <b>حالة البوت</b>\n\n`
        + `✅ <b>البوت:</b> شغال\n`
        + `⏰ <b>الوقت:</b> ${now}\n`
        + `📊 <b>المهمات:</b> ${missionRow?.c ?? 0}\n`
        + `📝 <b>التسجيلات:</b> ${regRow?.c ?? 0}`,
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    // ─── Create mission ───
    case 'create': {
      await tgAnswerCb(token, cqId);
      if (params[0] === 'start') {
        await startCreateWizard(token, chatId, db);
      }
      return;
    }

    // ─── Mission detail ───
    case 'mission': {
      await tgAnswerCb(token, cqId);
      if (params[0]) await showMissionDetail(token, chatId, db, params[0]);
      return;
    }

    // ─── Toggle registration ───
    case 'toggle': {
      await tgAnswerCb(token, cqId);
      if (params[0]) {
        await executeToggle(token, chatId, db, params[0]);
      } else {
        await startToggleWizard(token, chatId, db);
      }
      return;
    }

    // ─── Delete ───
    case 'delete': {
      await tgAnswerCb(token, cqId);
      if (params[0]) {
        await startDeleteWizard(token, chatId, db, params[0]);
      }
      return;
    }

    // ─── Cancel registration ───
    case 'cancelreg': {
      await tgAnswerCb(token, cqId);
      if (params[0] === 'start') {
        await startCancelWizard(token, chatId, db);
      } else if (params[0] === 'mission' && params[1]) {
        await startCancelVolunteerSelect(token, chatId, db, params[1]);
      } else if (params[0] === 'vol' && params[1]) {
        await confirmCancelRegistration(token, chatId, db, params[1]);
      }
      return;
    }

    // ─── Registrants ───
    case 'registrants': {
      await tgAnswerCb(token, cqId);
      if (params[0]) await showRegistrants(token, chatId, db, params[0]);
      return;
    }

    // ─── Waitlist ───
    case 'waitlist': {
      await tgAnswerCb(token, cqId);
      if (params[0]) await showWaitlist(token, chatId, db, params[0]);
      return;
    }

    // ─── Voice playback from notification ───
    case 'voice': {
      await tgAnswerCb(token, cqId);
      const missionCode = params[0];
      const status = params[1];
      // Find the latest CONFIRMED/WAITLIST registration with audio for this mission
      const reg = await db.prepare(`
        SELECT r.id, v.name, v.member_id, m.title, m.public_code, r.status
        FROM registrations r
        JOIN volunteers v ON r.volunteer_id = v.id
        JOIN missions m ON r.mission_id = m.id
        WHERE m.public_code = ? AND r.status IN ('CONFIRMED', 'WAITLIST')
        AND EXISTS (
          SELECT 1 FROM audio_confirmations ac WHERE ac.registration_id = r.id
        )
        ORDER BY r.created_at DESC
        LIMIT 1
      `).bind(missionCode).first() as any;
      
      if (!reg) {
        await tgSend(token, chatId, '❌ لا يوجد تسجيل صوتي لهذه المهمة.');
        return;
      }
      
      // Get audio file_id or data
      const audio = await db.prepare(`
        SELECT audio_key, audio_data, duration_ms FROM audio_confirmations WHERE registration_id = ?
      `).bind(reg.id).first() as any;
      
      if (!audio) {
        await tgSend(token, chatId, '❌ التسجيل الصوتي غير متاح.');
        return;
      }
      
      // Send audio info first
      await tgSend(token, chatId, 
        `🎙️ <b>تسجيل المتطوع</b>\n\n` +
        `👤 <b>الاسم:</b> ${reg.name}\n` +
        `🏷️ <b>رقم العضوية:</b> ${reg.member_id}\n` +
        `📋 <b>المهمة:</b> ${reg.title} (${reg.public_code})\n` +
        `📊 <b>الحالة:</b> ${REG_STATUS_AR[reg.status] || reg.status}\n` +
        `⏱️ <b>المدة:</b> ${Math.round((audio.duration_ms || 0) / 1000)} ثانية`
      );
      
      // If audio is in R2, we need to fetch and send
      // For now, we'll send a message that it's available on the website
      // TODO: Implement proper file_id storage when audio is uploaded to Telegram
      await tgSend(token, chatId,
              `📱 <b>التسجيل الصوتي مخزن في النظام.</b>\n\n` +
              `يمكنك الاستماع إليه من لوحة التحكم على الويب:\n` +
              `https://red-crescent-minya.pages.dev/admin\n\n` +
              `أو استخدم زر "🎙️ استمع للتسجيل" في لوحة التحكم.`
            );
      return;
    }

    // ─── Confirmation ───
    case 'confirm': {
      await tgAnswerCb(token, cqId);
      const confirmAction = params[0];
      const confirmId = params[1];

      if (confirmAction === 'create') {
        const session = await getSession(db, chatId);
        if (session.state === 'create_confirm') {
          await executeCreateMission(token, chatId, db, session.data);
        }
      } else if (confirmAction === 'cancelreg' && confirmId) {
        await executeCancelRegistration(token, chatId, db, confirmId);
      } else if (confirmAction === 'delete' && confirmId) {
        await executeDelete(token, chatId, db, confirmId);
      }
      return;
    }

    // ─── Cancel wizard ───
    case 'cancel': {
      await tgAnswerCb(token, cqId, 'تم الإلغاء');
      if (params[0] === 'wizard' || params[0] === 'action') {
        await clearSession(db, chatId);
        await tgSend(token, chatId, '🏠 <b>تم الإلغاء.</b>', { reply_markup: mainMenuKeyboard() });
      }
      return;
    }

    default: {
      await tgAnswerCb(token, cqId);
      return;
    }
  }
}

// ─── Main Webhook Handler ──────────────────────────────────────
telegramRoutes.post('/', async (c) => {
  const db = c.env.DB;
  const token = c.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN not set');
    return c.json({ ok: false, error: 'Bot token not configured' }, 500);
  }

  let update: any;
  try {
    update = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  // ─── Callback Query (inline button press) ──────────
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message?.chat?.id;
    if (!chatId || !isAuthorizedChat(chatId, c.env.ADMIN_CHAT_IDS)) {
      await tgAnswerCb(token, cq.id, '⚠️ غير مصرح لك.');
      return c.json({ ok: true });
    }
    await handleCallbackQuery(token, chatId, db, cq);
    return c.json({ ok: true });
  }

  // ─── Text Messages ─────────────────────────────────
  if (!update.message || !update.message.text) return c.json({ ok: true });

  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  // Security: only authorized chats
  if (!isAuthorizedChat(chatId, c.env.ADMIN_CHAT_IDS)) {
    await tgSend(token, chatId, '⚠️ <b>غير مصرح لك.</b>\n\nتواصل مع مدير النظام للحصول على صلاحية.');
    return c.json({ ok: true });
  }

  console.log(`📨 @${msg.from?.username || msg.from?.first_name} (${chatId}): ${text.slice(0, 80)}`);

  // ─── Quick command: /start ─────────────────────────
  if (text.startsWith('/start')) {
    await clearSession(db, chatId);
    const kb = new InlineKeyboard()
      .text('➕ مهمة جديدة', 'create:start')
      .text('📋 كل المهمات', 'list:all')
      .row()
      .text('📊 إحصائيات', 'stats:show')
      .text('❓ مساعدة', 'help:show');
    await tgSend(token, chatId,
      `🌟 <b>مرحباً بيك في بوت إدارة مهام الإسعاف!</b>\n\n`
      + `🤖 أنا البوت الذكي — اكتب بالعربي العادي وأنا هفهمك.\n\n`
      + `💡 جرّب اكتب:\n`
      + `  • "اعمل مهمه"\n`
      + `  • "شوف المهمات"\n`
      + `  • "إحصائيات"\n\n`
      + `أو استخدم الأزرار بالأسفل 👇`,
      { reply_markup: kb }
    );
    return c.json({ ok: true });
  }

  // ─── Quick command: /help ──────────────────────────
  if (text.startsWith('/help') || text.startsWith('/cancel')) {
    if (text.startsWith('/cancel')) {
      await clearSession(db, chatId);
      await tgSend(token, chatId, '🏠 <b>تم الإلغاء.</b>', { reply_markup: mainMenuKeyboard() });
    } else {
      await tgSend(token, chatId, helpText(), { reply_markup: mainMenuKeyboard() });
    }
    return c.json({ ok: true });
  }

  // ─── Check wizard state first ──────────────────────
  const session = await getSession(db, chatId);
  if (session.state !== 'idle') {
    const handled = await handleWizardMessage(token, chatId, db, text, session);
    if (handled) return c.json({ ok: true });
  }

  // ─── AI / Rule-based Intent Parsing ────────────────
  const intent = await parseIntent(text, c.env.AI);

  switch (intent.intent) {
    case 'create_mission': {
      // Start wizard, pre-fill from AI extracted data
      const data: WizardData = {};
      if (intent.extracted.title) data.title = intent.extracted.title;
      if (intent.extracted.location) data.location = intent.extracted.location;
      if (intent.extracted.time) data.time = intent.extracted.time;

      if (data.title && data.location) {
        // AI extracted enough — go to capacity
        data.capacity = intent.extracted.capacity || 0;
        await setSession(db, chatId, 'create_capacity', data);
        await tgSend(token, chatId,
          `✅ الاسم: <b>${data.title}</b>\n✅ المقر: <b>${data.location}</b>\n\n`
          + `👥 كم متطوع مطلوب؟ (اتركه فاضي لو بدون حد أقصى)`,
          { reply_markup: new InlineKeyboard().text('❌ إلغاء', 'cancel:wizard') }
        );
      } else if (data.title) {
        await setSession(db, chatId, 'create_location', data);
        await tgSend(token, chatId,
          `✅ الاسم: <b>${data.title}</b>\n\n📍 اكتب المقر أو العنوان:`,
          { reply_markup: new InlineKeyboard().text('❌ إلغاء', 'cancel:wizard') }
        );
      } else {
        await startCreateWizard(token, chatId, db);
      }
      break;
    }

    case 'list_missions': {
      await showMissions(token, chatId, db);
      break;
    }

    case 'list_active': {
      await showMissions(token, chatId, db, 'active');
      break;
    }

    case 'stats': {
      const hint = intent.extracted.missionCode || intent.extracted.missionHint;
      await showStats(token, chatId, db, hint);
      break;
    }

    case 'status': {
      const missionRow = await db.prepare('SELECT COUNT(*) as c FROM missions').first() as any;
      const regRow = await db.prepare('SELECT COUNT(*) as c FROM registrations').first() as any;
      const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
      await tgSend(token, chatId,
        `🤖 <b>حالة البوت</b>\n\n`
        + `✅ <b>البوت:</b> شغال\n`
        + `⏰ <b>الوقت:</b> ${now}\n`
        + `📊 <b>المهمات:</b> ${missionRow?.c ?? 0}\n`
        + `📝 <b>التسجيلات:</b> ${regRow?.c ?? 0}`,
        { reply_markup: mainMenuKeyboard() }
      );
      break;
    }

    case 'help': {
      await tgSend(token, chatId, helpText(), { reply_markup: mainMenuKeyboard() });
      break;
    }

    case 'delete_mission': {
      const hint = intent.extracted.missionCode || intent.extracted.missionHint;
      await startDeleteWizard(token, chatId, db, hint || undefined);
      break;
    }

    case 'close_mission': {
      const hint = intent.extracted.missionCode || intent.extracted.missionHint;
      if (hint) {
        const mission = await findMissionByHint(db, hint);
        if (mission) {
          await db.prepare(
            "UPDATE missions SET status = 'CLOSED', registration_close_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
          ).bind(mission.id).run();
          const kb = missionActionsKeyboard(mission.id, mission.public_code, 'CLOSED');
          await tgSend(token, chatId,
            `🔴 <b>تم إغلاق التسجيل!</b>\n\n📋 ${mission.title} (${mission.public_code})`,
            { reply_markup: kb }
          );
          break;
        }
      }
      await startToggleWizard(token, chatId, db);
      break;
    }

    case 'toggle_registration': {
      await startToggleWizard(token, chatId, db);
      break;
    }

    case 'cancel_registration': {
      // Direct execution when AI extracted member number (e.g. "شيل أحمد رقم عضويته 123 من مهمه MNY-379")
      if (intent.extracted.memberNumber) {
        const handled = await executeCancelByMember(
          token, chatId, db,
          intent.extracted.memberNumber,
          intent.extracted.missionCode || intent.extracted.missionHint
        );
        if (handled) break;
      }
      await startCancelWizard(token, chatId, db);
      break;
    }

    case 'view_registrants': {
      const hint = intent.extracted.missionCode || intent.extracted.missionHint;
      if (hint) {
        const mission = await findMissionByHint(db, hint);
        if (mission) {
          await showRegistrants(token, chatId, db, mission.id);
          break;
        }
      }
      // Show list to pick from
      await startCancelWizard(token, chatId, db);
      break;
    }

    case 'view_waitlist': {
      const hint = intent.extracted.missionCode || intent.extracted.missionHint;
      if (hint) {
        const mission = await findMissionByHint(db, hint);
        if (mission) {
          await showWaitlist(token, chatId, db, mission.id);
          break;
        }
      }
      // Show list to pick from
      const rows = await db.prepare(
        "SELECT id, public_code, title FROM missions WHERE status IN ('OPEN','CLOSED') ORDER BY created_at DESC LIMIT 10"
      ).all();
      if (rows.results?.length) {
        const kb = new InlineKeyboard();
        for (const m of rows.results) {
          kb.text(`${m.public_code} — ${m.title}`, `waitlist:${m.id}`).row();
        }
        kb.text('❌ إلغاء', 'cancel:action');
        await tgSend(token, chatId, '⏳ <b>اختر المهمة:</b>', { reply_markup: kb });
      } else {
        await tgSend(token, chatId, '📋 لا توجد مهمات.');
      }
      break;
    }

    default: {
      // Unknown intent — send helpful fallback with buttons
      await tgSend(token, chatId,
        `🤔 مش متأكد قصدك إيه بالظبط.\n\n`
        + `💡 جرّب تكتب:\n`
        + `  • "اعمل مهمه" — لإنشاء مهمة جديدة\n`
        + `  • "شوف المهمات" — لعرض المهمات\n`
        + `  • "إحصائيات" — للتقرير\n`
        + `  • "مساعدة" — لقائمة الأوامر\n\n`
        + `أو استخدم الأزرار 👇`,
        { reply_markup: mainMenuKeyboard() }
      );
    }
  }

  return c.json({ ok: true });
});

// ─── Health check ──────────────────────────────────────────────
telegramRoutes.get('/', (c) => c.json({ ok: true, bot: 'red-crescent-ai-bot', version: '2.0' }));
