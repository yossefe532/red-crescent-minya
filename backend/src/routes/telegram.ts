/**
 * Telegram Bot Webhook Handler — Cloudflare Workers compatible
 * Receives updates from Telegram and routes commands to the D1 database.
 */

import { Hono } from 'hono';

export const telegramRoutes = new Hono<{ Bindings: any }>();

/**
 * POST /telegram — receives updates from Telegram servers
 */
telegramRoutes.post('/', async (c) => {
  const BOT_TOKEN = c.env['TELEGRAM_BOT_TOKEN'] || '';
  const ADMIN_CHAT_ID = c.env['ADMIN_CHAT_ID'] || '';

  if (!BOT_TOKEN) {
    return c.json({ ok: false, error: 'TELEGRAM_BOT_TOKEN not set' }, 500);
  }

  const update: any = await c.req.json();

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const from = msg.from;

    console.log(`📨 ${from?.first_name} (@${from?.username}): ${text}`);

    // Dispatch commands
    if (text.startsWith('/start')) {
      await tgSend(BOT_TOKEN, chatId, getStartMessage());
    } else if (text.startsWith('/help')) {
      await tgSend(BOT_TOKEN, chatId, getHelpMessage());
    } else if (text.startsWith('/list')) {
      await handleList(c.env.DB, BOT_TOKEN, chatId, text.replace('/list', '').trim());
    } else if (text.startsWith('/create')) {
      await handleCreate(c.env.DB, BOT_TOKEN, chatId, text.replace('/create', '').trim());
    } else if (text.startsWith('/stats')) {
      await handleStats(c.env.DB, BOT_TOKEN, chatId, text.replace('/stats', '').trim());
    } else if (text.startsWith('/toggle')) {
      await handleToggle(c.env.DB, BOT_TOKEN, chatId, ADMIN_CHAT_ID, text.replace('/toggle', '').trim());
    } else if (text.startsWith('/close')) {
      await handleClose(c.env.DB, BOT_TOKEN, chatId, ADMIN_CHAT_ID, text.replace('/close', '').trim());
    } else if (text.startsWith('/delete')) {
      await handleDelete(c.env.DB, BOT_TOKEN, chatId, ADMIN_CHAT_ID, text.replace('/delete', '').trim());
    } else if (text.startsWith('/registrants')) {
      await handleRegistrants(c.env.DB, BOT_TOKEN, chatId, text.replace('/registrants', '').trim());
    } else if (text.startsWith('/waitlist')) {
      await handleWaitlist(c.env.DB, BOT_TOKEN, chatId, text.replace('/waitlist', '').trim());
    } else if (text.startsWith('/cancel')) {
      await handleCancel(c.env.DB, BOT_TOKEN, chatId, ADMIN_CHAT_ID, text.replace('/cancel', '').trim());
    } else if (text.startsWith('/notify')) {
      await handleNotify(BOT_TOKEN, chatId, text.replace('/notify', '').trim());
    } else if (text.startsWith('/notifications')) {
      await tgSend(BOT_TOKEN, chatId, '🔔 الإشعارات التلقائية <b>مُفعّلة</b>');
    } else if (text.startsWith('/status')) {
      await handleStatus(c.env.DB, BOT_TOKEN, chatId);
    } else {
      await tgSend(BOT_TOKEN, chatId, '❌ أمر غير معروف. اكتب /help لعرض الأوامر.');
    }
  }

  return c.json({ ok: true });
});

// ─── Helpers ───────────────────────────────────────────────────

/** Send a message via Telegram Bot API */
async function tgSend(token: string, chatId: number, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (err) {
    console.error('Telegram send error:', err);
  }
}

/** Send notification to admin chat */
async function tgNotify(token: string, adminChatId: string, message: string): Promise<void> {
  if (!adminChatId) return;
  await tgSend(token, parseInt(adminChatId), `🔔 <b>إشعار</b>\n\n${message}`);
}

/** Format a mission object as HTML text */
function fmtMission(m: any): string {
  const emoji: Record<string, string> = {
    DRAFT: '📝', OPEN: '🟢', CLOSED: '🔴', CANCELLED: '❌', COMPLETED: '✅',
  };
  return `${emoji[m.status] || '⚪'} <b>${m.title}</b>
🆔 <code>${m.id}</code>
📍 ${m.location || 'غير محدد'}
👥 السعة: ${m.registered_count ?? 0}/${m.capacity}
🔄 التسجيل: ${m.registration_open ? '✅ مفتوح' : '❌ مغلق'}`;
}

// ─── /start & /help ────────────────────────────────────────────

function getStartMessage(): string {
  return `🔴 <b>بوت إدارة مهمات الهلال الأحمر — المنيا</b>

مرحباً بك يا أستاذ الأدمن! 👋

📋 <b>الأوامر المتاحة:</b>

🔧 <b>إدارة المهمات:</b>
  /create — إنشاء مهمة جديدة
  /list — عرض كل المهمات
  /stats &lt;id&gt; — إحصائيات مهمة
  /toggle &lt;id&gt; on/off — فتح/قفل التسجيل
  /close &lt;id&gt; — إغلاق مهمة نهائيًّا
  /delete &lt;id&gt; — حذف مهمة

👥 <b>إدارة التسجيلات:</b>
  /registrants &lt;id&gt; — قائمة المشاركين
  /waitlist &lt;id&gt; — قائمة الانتظار
  /cancel &lt;id&gt; &lt;regId&gt; — إلغاء تسجيل

🔔 <b>الإشعارات:</b>
  /notify on/off — تفعيل/تعطيل الإشعارات

ℹ️ <b>مساعدة:</b>
  /help — مساعدة مفصّلة
  /status — حالة البوت والخادم`;
}

function getHelpMessage(): string {
  return `📖 <b>مساعدة مفصّلة</b>

<b>إنشاء مهمة جديدة:</b>
  /create title:عنوان capacity:50 location:المنيا

<b>التحكم في التسجيل:</b>
  /toggle &lt;id&gt; on — فتح التسجيل
  /toggle &lt;id&gt; off — قفل التسجيل

<b>عرض المعلومات:</b>
  /list — كل المهمات
  /list active — المهمات النشطة فقط
  /stats &lt;id&gt; — تفاصيل إحصائيات
  /registrants &lt;id&gt; — أسماء المشاركين
  /waitlist &lt;id&gt; — قائمة الانتظار

<b>الإشعارات:</b>
  /notify on — إشعارات تلقائية عند اكتمال السعة
  /notify off — تعطيل الإشعارات`;
}

// ─── /list ─────────────────────────────────────────────────────

async function handleList(db: D1Database, token: string, chatId: number, filter: string): Promise<void> {
  let query = 'SELECT * FROM missions ORDER BY created_at DESC';
  if (filter === 'active') query = "SELECT * FROM missions WHERE status = 'OPEN' ORDER BY created_at DESC";
  else if (filter === 'closed') query = "SELECT * FROM missions WHERE status = 'CLOSED' ORDER BY created_at DESC";

  const { results } = await db.prepare(query).all();
  if (!results.length) return tgSend(token, chatId, '📭 لا توجد مهمات حالياً.');

  let text = `📋 <b>قائمة المهمات (${results.length})</b>\n\n`;
  for (const m of results) text += fmtMission(m) + '\n\n';

  await tgSend(token, chatId, text);
}

// ─── /create ───────────────────────────────────────────────────

async function handleCreate(db: D1Database, token: string, chatId: number, args: string): Promise<void> {
  const get = (k: string) => args.match(new RegExp(`${k}:(\\S+)`))?.[1] ?? null;
  const title = get('title');
  const capacity = parseInt(get('capacity') || '0');
  const location = get('location') || 'غير محدد';

  if (!title || isNaN(capacity) || capacity <= 0) {
    return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب title و capacity صحيح\nمثال: /create title:مهمة capacity:50');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO missions (id, title, description, location, start_at, end_at, capacity, status, registration_open, created_at, updated_at)
     VALUES (?, ?, '', ?, ?, ?, ?, 'DRAFT', 0, ?, ?)`
  ).bind(id, title, location, now, new Date(Date.now() + 86400000).toISOString(), capacity, now, now).run();

  await tgSend(token, chatId, `✅ <b>تم إنشاء المهمة!</b>\n\n📌 ${title}\n👥 السعة: ${capacity}\n📍 الموقع: ${location}\n🆔 <code>${id}</code>`);
}

// ─── /stats ────────────────────────────────────────────────────

async function handleStats(db: D1Database, token: string, chatId: number, missionId: string): Promise<void> {
  if (!missionId) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID المهمة\nمثال: /stats ABC123');

  const mission = await db.prepare('SELECT * FROM missions WHERE id = ?').bind(missionId).first() as any;
  if (!mission) return tgSend(token, chatId, `❌ المهمة <code>${missionId}</code> غير موجودة.`);

  const { results: stats } = await db.prepare(
    "SELECT status, COUNT(*) as count FROM registrations WHERE mission_id = ? GROUP BY status"
  ).bind(missionId).all();

  let text = `📊 <b>إحصائيات المهمة</b>\n\n${fmtMission(mission)}\n\n<b>التسجيلات:</b>\n`;
  for (const s of stats) text += `  ${s.status}: ${s.count}\n`;
  const total = stats.reduce((a: number, b: any) => a + Number(b.count), 0);
  text += `\n<b>المجموع:</b> ${total}`;

  await tgSend(token, chatId, text);
}

// ─── /toggle ───────────────────────────────────────────────────

async function handleToggle(db: D1Database, token: string, chatId: number, adminChatId: string, args: string): Promise<void> {
  const [missionId, action] = args.split(/\s+/);
  if (!missionId || !action) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID والحالة\nمثال: /toggle ABC123 on');

  const isOpen = action === 'on' || action === 'open' || action === 'true';

  await db.prepare('UPDATE missions SET registration_open = ?, updated_at = ? WHERE id = ?')
    .bind(isOpen ? 1 : 0, new Date().toISOString(), missionId).run();

  const mission = await db.prepare('SELECT * FROM missions WHERE id = ?').bind(missionId).first() as any;
  await tgSend(token, chatId, `${isOpen ? '🟢' : '🔴'} <b>${isOpen ? 'فُتح' : 'قُفل'} التسجيل</b>\n\n${fmtMission(mission)}`);
  await tgNotify(token, adminChatId, `${isOpen ? '🟢' : '🔴'} التسجيل ${isOpen ? 'فُتح' : 'قُفل'} للمهمة ${missionId}`);
}

// ─── /close ────────────────────────────────────────────────────

async function handleClose(db: D1Database, token: string, chatId: number, adminChatId: string, missionId: string): Promise<void> {
  if (!missionId) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID المهمة\nمثال: /close ABC123');

  await db.prepare("UPDATE missions SET status = 'CLOSED', registration_open = 0, updated_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), missionId).run();

  await tgSend(token, chatId, `🔴 <b>تم إغلاق المهمة ${missionId}</b>`);
  await tgNotify(token, adminChatId, `🔴 تم إغلاق المهمة ${missionId}`);
}

// ─── /delete ───────────────────────────────────────────────────

async function handleDelete(db: D1Database, token: string, chatId: number, adminChatId: string, missionId: string): Promise<void> {
  if (!missionId) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID المهمة\nمثال: /delete ABC123');

  await db.prepare('DELETE FROM missions WHERE id = ?').bind(missionId).run();

  await tgSend(token, chatId, `🗑️ <b>تم حذف المهمة ${missionId}</b>`);
  await tgNotify(token, adminChatId, `🗑️ تم حذف المهمة ${missionId}`);
}

// ─── /registrants ──────────────────────────────────────────────

async function handleRegistrants(db: D1Database, token: string, chatId: number, missionId: string): Promise<void> {
  if (!missionId) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID المهمة\nمثال: /registrants ABC123');

  const mission = await db.prepare('SELECT * FROM missions WHERE id = ?').bind(missionId).first() as any;
  if (!mission) return tgSend(token, chatId, `❌ المهمة <code>${missionId}</code> غير موجودة.`);

  const { results: regs } = await db.prepare(
    "SELECT * FROM registrations WHERE mission_id = ? AND status = 'CONFIRMED' ORDER BY created_at DESC"
  ).bind(missionId).all();

  if (!regs.length) return tgSend(token, chatId, `📭 لا يوجد مشاركين في المهمة ${missionId}.`);

  let text = `👥 <b>المشاركون في ${mission.title}</b> (${regs.length})\n\n`;
  regs.forEach((r: any, i: number) => {
    text += `${i + 1}. ${r.member_name} (${r.member_id})\n📱 ${r.phone}\n\n`;
  });

  await tgSend(token, chatId, text);
}

// ─── /waitlist ─────────────────────────────────────────────────

async function handleWaitlist(db: D1Database, token: string, chatId: number, missionId: string): Promise<void> {
  if (!missionId) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID المهمة\nمثال: /waitlist ABC123');

  const { results } = await db.prepare(
    "SELECT * FROM registrations WHERE mission_id = ? AND status = 'WAITLISTED' ORDER BY created_at ASC"
  ).bind(missionId).all();

  if (!results.length) return tgSend(token, chatId, `📭 قائمة الانتظار فارغة للمهمة ${missionId}.`);

  let text = `📋 <b>قائمة الانتظار</b> (${results.length})\n\n`;
  results.forEach((r: any, i: number) => {
    text += `${i + 1}. ${r.member_name} (${r.member_id})\n📱 ${r.phone}\n\n`;
  });

  await tgSend(token, chatId, text);
}

// ─── /cancel ───────────────────────────────────────────────────

async function handleCancel(db: D1Database, token: string, chatId: number, adminChatId: string, args: string): Promise<void> {
  const [missionId, regId] = args.split(/\s+/);
  if (!missionId || !regId) return tgSend(token, chatId, '❌ <b>خطأ:</b> مطلوب ID المهمة و ID التسجيل\nمثال: /cancel ABC123 REG-ID');

  await db.prepare("UPDATE registrations SET status = 'CANCELLED' WHERE id = ?").bind(regId).run();

  await tgSend(token, chatId, `✅ <b>تم إلغاء التسجيل ${regId}</b>`);
  await tgNotify(token, adminChatId, `❌ تم إلغاء التسجيل ${regId} من المهمة ${missionId}`);
}

// ─── /notify ───────────────────────────────────────────────────

async function handleNotify(token: string, chatId: number, action: string): Promise<void> {
  if (action === 'on' || action === 'true') {
    await tgSend(token, chatId, '🔔 <b>الإشعارات التلقائية: مُفعّلة</b>');
  } else if (action === 'off' || action === 'false') {
    await tgSend(token, chatId, '🔕 <b>الإشعارات التلقائية: معطلة</b>');
  } else {
    await tgSend(token, chatId, '❌ <b>خطأ:</b> استخدم /notify on أو /notify off');
  }
}

// ─── /status ───────────────────────────────────────────────────

async function handleStatus(db: D1Database, token: string, chatId: number): Promise<void> {
  const missionRow = await db.prepare('SELECT COUNT(*) as c FROM missions').first() as any;
  const regRow = await db.prepare('SELECT COUNT(*) as c FROM registrations').first() as any;

  const now = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' });
  await tgSend(token, chatId,
    `🤖 <b>حالة البوت</b>\n\n✅ <b>البوت:</b> شغال\n⏰ <b>الوقت:</b> ${now}\n📊 <b>المهمات:</b> ${missionRow?.c ?? 0}\n📝 <b>التسجيلات:</b> ${regRow?.c ?? 0}`
  );
}