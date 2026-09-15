/**
 * Telegram Bot — Mission Commands Handler
 * /missions, /stats, /detail, /link, /whatsapp, /export, /health
 */
import { tgSend, tgSendDocument, escapeHtml } from '../bot';
import {
  statusLabel,
  formatMissionDetail,
  formatMissionListItem,
  formatStats,
  formatEnhancedStats,
  formatHealth,
  buildWhatsAppMessage,
  formatRequirementsSummary,
  formatQuestionsSummary,
} from '../formatters';
import {
  mainMenuKeyboard,
  missionListKeyboard,
  missionDetailKeyboard,
  backToMissionKeyboard,
  backToHomeKeyboard,
  missionPickerKeyboard,
} from '../keyboards';
import {
  getMissionById,
  getMissionAvailability,
  listMissions,
  getMissionByPublicCode,
} from '../../services/mission.service';
import { APP_TIMEZONE } from '../../config/timezone';
import { getMissionRequirements, getMissionQuestions } from '../../services/mission.requirements.service';

// Re-export for external modules
export { getMissionAvailability, formatMissionDetail };

// ─── List Missions (With Filter & Pagination) ───────────────────
export async function handleListMissions(
  token: string,
  chatId: number,
  db: D1Database,
  page: number = 1,
  filter: string = 'ALL'
): Promise<void> {
  const limit = 5;
  const offset = Math.max(0, (page - 1) * limit);
  const statusFilter = filter === 'ALL' ? undefined : filter;

  const result = await listMissions(db, { limit, offset, status: statusFilter });
  const total = result.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  if (!result.missions.length) {
    const filterText =
      filter === 'OPEN' ? 'المفتوحة' : filter === 'CLOSED' ? 'المغلقة' : '';
    await tgSend(
      token,
      chatId,
      `📋 لا توجد مهام ${filterText} حالياً.`,
      {
        reply_markup: missionListKeyboard([], 1, 1, filter),
      }
    );
    return;
  }

  // Fetch availability for each mission in page
  const availabilityResults = await Promise.all(
    result.missions.map((m) =>
      getMissionAvailability(db, m.id).catch(() => ({
        confirmed: 0,
        waitlist: 0,
        capacity: m.capacity ?? 0,
        waiting_list: m.waiting_list ?? 0,
        available: m.capacity ?? 0,
        waitlist_available: m.waiting_list ?? 0,
      }))
    )
  );

  let msg = `📋 <b>قائمة المهام</b> (صفحة ${currentPage} من ${totalPages})\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;

  for (let i = 0; i < result.missions.length; i++) {
    const m = result.missions[i];
    const avail = availabilityResults[i];

    msg += formatMissionListItem(
      m,
      avail.confirmed,
      avail.capacity,
      avail.waitlist,
      avail.waiting_list
    );

    if (i < result.missions.length - 1) {
      msg += '\n\n';
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━\n💡 اختر مهمة من الأزرار أدناه لعرض التفاصيل والإدارة 👇`;

  await tgSend(token, chatId, msg, {
    reply_markup: missionListKeyboard(
      result.missions.map((m) => ({
        id: m.id,
        public_code: m.public_code,
        title: m.title,
        status: m.status,
      })),
      currentPage,
      totalPages,
      filter
    ),
  });
}

// ─── Mission Stats ─────────────────────────────────────────────
export async function handleStats(
  token: string,
  chatId: number,
  db: D1Database
): Promise<void> {
  const total = (await db.prepare('SELECT COUNT(*) as c FROM missions').first()) as any;
  const open = (await db
    .prepare("SELECT COUNT(*) as c FROM missions WHERE status = 'OPEN'")
    .first()) as any;
  const closed = (await db
    .prepare("SELECT COUNT(*) as c FROM missions WHERE status = 'CLOSED'")
    .first()) as any;
  const regs = (await db.prepare('SELECT COUNT(*) as c FROM registrations').first()) as any;
  const confirmed = (await db
    .prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'CONFIRMED'")
    .first()) as any;
  const waitlist = (await db
    .prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'WAITLIST'")
    .first()) as any;
  const cancelled = (await db
    .prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'CANCELLED'")
    .first()) as any;
  const todayRegs = (await db
    .prepare("SELECT COUNT(*) as c FROM registrations WHERE created_at >= date('now')")
    .first()) as any;
  const mostActiveResult = await db
    .prepare(
      `SELECT m.title, m.public_code, COUNT(r.id) as count
       FROM registrations r JOIN missions m ON r.mission_id = m.id
       GROUP BY r.mission_id ORDER BY count DESC LIMIT 3`
    )
    .all();

  const stats = {
    totalMissions: total?.c ?? 0,
    openMissions: open?.c ?? 0,
    closedMissions: closed?.c ?? 0,
    totalRegistrations: regs?.c ?? 0,
    confirmed: confirmed?.c ?? 0,
    waitlist: waitlist?.c ?? 0,
    cancelled: cancelled?.c ?? 0,
    todayRegistrations: todayRegs?.c ?? 0,
    mostActiveMissions: (mostActiveResult.results || []) as Array<{ title: string; public_code: string; count: number }>,
  };

  await tgSend(token, chatId, formatEnhancedStats(stats), {
    reply_markup: mainMenuKeyboard(),
  });
}

// ─── Health Check ──────────────────────────────────────────────
export async function handleHealth(
  token: string,
  chatId: number,
  db: D1Database
): Promise<void> {
  try {
    const missionCount = await db
      .prepare('SELECT COUNT(*) as c FROM missions')
      .first<{ c: number }>();
    const regCount = await db
      .prepare('SELECT COUNT(*) as c FROM registrations')
      .first<{ c: number }>();
    const notifRow = await db
      .prepare("SELECT value FROM settings WHERE key = 'notifications_enabled'")
      .first<{ value: string }>();

    await tgSend(
      token,
      chatId,
      formatHealth({
        backend: true,
        database: true,
        bot: true,
        notifications: notifRow?.value === '1' || notifRow?.value === 'true',
        missionCount: missionCount?.c ?? 0,
        registrationCount: regCount?.c ?? 0,
      }),
      { reply_markup: backToHomeKeyboard() }
    );
  } catch (e: any) {
    console.error('Health check failed:', e);
    await tgSend(token, chatId, `❌ فشل فحص النظام: ${e?.message || String(e)}`, {
      reply_markup: backToHomeKeyboard(),
    });
  }
}

// ─── Mission Detail (By ID or Public Code) ──────────────────────
export async function handleMissionDetail(
  token: string,
  chatId: number,
  db: D1Database,
  missionIdOrCode: string
): Promise<void> {
  try {
    let mission = await getMissionById(db, missionIdOrCode);
    if (!mission) {
      mission = await getMissionByPublicCode(db, missionIdOrCode);
    }
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة أو تم حذفها.', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    const status = mission.status ?? 'DRAFT';
    const availability = await getMissionAvailability(db, mission.id);
    const baseMsg = formatMissionDetail(mission, availability);

    // Append requirements & questions summary if they exist
    let extra = '';
    try {
      const reqs = await getMissionRequirements(db, mission.id);
      extra += formatRequirementsSummary(reqs);
    } catch { /* no requirements */ }
    try {
      const qs = await getMissionQuestions(db, mission.id);
      extra += formatQuestionsSummary(qs);
    } catch { /* no questions */ }

    await tgSend(token, chatId, baseMsg + extra, {
      reply_markup: missionDetailKeyboard(mission.id, status),
    });
  } catch (err: any) {
    console.error('[handleMissionDetail] Error:', err);
    await tgSend(
      token,
      chatId,
      `❌ <b>خطأ في عرض التفاصيل:</b>\n<code>${err?.message || String(err)}</code>\n\nجرب /start`,
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

// ─── Get Mission Registration Link ──────────────────────────────
export async function handleGetLink(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  try {
    let mission = await getMissionById(db, missionId);
    if (!mission) {
      mission = await getMissionByPublicCode(db, missionId);
    }
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    const url = `https://red-crescent-minya.pages.dev/m/${mission.public_code}`;

    const kb = backToMissionKeyboard(mission.id);
    await tgSend(
      token,
      chatId,
      `🔗 <b>رابط التسجيل لمهمة ${mission.public_code} (${escapeHtml(mission.title)}):</b>\n\n<code>${url}</code>`,
      { reply_markup: kb }
    );
  } catch (err: any) {
    console.error('[handleGetLink] Error:', err);
    await tgSend(
      token,
      chatId,
      `❌ خطأ في جلب الرابط: ${err?.message || String(err)}`,
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

// ─── WhatsApp Message Template ──────────────────────────────────
export async function handleWhatsAppMessage(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  try {
    let mission = await getMissionById(db, missionId);
    if (!mission) {
      mission = await getMissionByPublicCode(db, missionId);
    }
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    const msg = buildWhatsAppMessage(mission);

    const kb = backToMissionKeyboard(mission.id);
    await tgSend(
      token,
      chatId,
      `📲 <b>رسالة الواتساب للمهمة ${mission.public_code}:</b>\n\n<code>${msg}</code>`,
      { reply_markup: kb }
    );
  } catch (err: any) {
    console.error('[handleWhatsAppMessage] Error:', err);
    await tgSend(
      token,
      chatId,
      `❌ خطأ في إنشاء رسالة الواتساب: ${err?.message || String(err)}`,
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

// ─── Export CSV ────────────────────────────────────────────────
export async function handleExportCSV(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  try {
    let mission = await getMissionById(db, missionId);
    if (!mission) {
      mission = await getMissionByPublicCode(db, missionId);
    }
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.', {
        reply_markup: mainMenuKeyboard(),
      });
      return;
    }

    // Fetch all registrations
    const regsResult = await db
      .prepare(
        `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
                r.created_at, v.member_id, v.name as volunteer_name, v.phone
         FROM registrations r
         JOIN volunteers v ON v.id = r.volunteer_id
         WHERE r.mission_id = ?
         ORDER BY r.registration_sequence ASC`
      )
      .bind(mission.id)
      .all();

    const regs = regsResult.results || [];

    // Build CSV with BOM
    const BOM = '\uFEFF';
    const headers =
      'الترتيب,رقم العضوية,الاسم,رقم التليفون,الحالة,رقم المقعد,الموقع في الانتظار,تاريخ التسجيل\n';
    const rows = regs
      .map((r: any, idx: number) => {
        const statusAr =
          r.status === 'CONFIRMED'
            ? 'مؤكد'
            : r.status === 'WAITLIST'
            ? 'انتظار'
            : r.status === 'CANCELLED'
            ? 'ملغي'
            : 'قيد المراجعة';
        return `${idx + 1},"${r.member_id}","${r.volunteer_name}","${r.phone || ''}","${statusAr}","${r.seat_number || '-'}","${r.waitlist_position || '-'}","${new Date(r.created_at.endsWith('Z') || r.created_at.includes('+') ? r.created_at : r.created_at + 'Z').toLocaleString('ar-EG', { timeZone: APP_TIMEZONE })}"`;

      })
      .join('\n');

    const csv = BOM + headers + rows;

    // Send as document
    await tgSendDocument(
      token,
      chatId,
      new TextEncoder().encode(csv),
      `mission_${mission.public_code}_registrations.csv`,
      `📊 بيانات تسجيل مهمة ${mission.public_code}`,
      'text/csv'
    );

    const kb = backToMissionKeyboard(mission.id);
    await tgSend(token, chatId, '✅ تم تصدير ملف CSV.', { reply_markup: kb });
  } catch (err: any) {
    console.error('[handleExportCSV] Error:', err);
    await tgSend(
      token,
      chatId,
      `❌ خطأ في تصدير CSV: ${err?.message || String(err)}`,
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

// ─── Mission Picker for Registrants ─────────────────────────────
export async function handleMissionSelectForRegistrants(
  token: string,
  chatId: number,
  db: D1Database
): Promise<void> {
  const result = await listMissions(db, { limit: 20, offset: 0 });
  if (!result.missions.length) {
    await tgSend(token, chatId, '📋 لا توجد مهام مسجلة حالياً.', {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }
  await tgSend(
    token,
    chatId,
    '👥 <b>اختر المهمة لعرض المتطوعين والمسجلين:</b>',
    {
      reply_markup: missionPickerKeyboard(
        result.missions.map((m) => ({
          id: m.id,
          public_code: m.public_code,
          title: m.title,
          status: m.status,
        })),
        'm:regs'
      ),
    }
  );
}
