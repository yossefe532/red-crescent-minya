/**
 * Telegram Bot — Mission Commands Handler
 * /list, /stats, /detail, /link, /whatsapp, /export
 */
import { tgSend, tgEdit, tgAnswerCb, tgSendVoice, tgSendDocument, isAuthorizedChat, getSession, setSession, clearSession, escapeHtml } from '../bot';
import { statusLabel, regStatusLabel, formatDate, formatDateShort, formatMissionDetail, formatMissionListItem, formatVolunteerDetail, formatRegistrationNotification, formatStats, formatHealth, helpText, buildWhatsAppMessage, formatCreateSummary } from '../formatters';
import { mainMenuKeyboard, missionListKeyboard, missionDetailKeyboard, volunteerActionsKeyboard, skipButtonKeyboard, cancelWizardKeyboard, createConfirmKeyboard, confirmActionKeyboard, editFieldKeyboard, notificationSettingsKeyboard, backToMissionKeyboard, backToHomeKeyboard, missionPickerKeyboard } from '../keyboards';
import { logAudit } from '../../services/audit.service';
import { getMissionById, getMissionAvailability, listMissions, getMissionByPublicCode } from '../../services/mission.service';
import { Env } from '../../env';

// Re-export for callbacks.ts
export { getMissionAvailability, formatMissionDetail };

// ─── List Missions ─────────────────────────────────────────────
export async function handleListMissions(
  token: string,
  chatId: number,
  db: D1Database,
  env: Env,
  onlyActive: boolean = false
): Promise<void> {
  const missions = await listMissions(db, { limit: 20, offset: 0, status: onlyActive ? 'OPEN' : undefined });
  
  if (!missions.missions.length) {
    await tgSend(token, chatId, '📋 لا توجد مهمات.');
    return;
  }

  // Fetch availability for each mission
  const availabilityPromises = missions.missions.map(m => 
    getMissionAvailability(db, m.id).catch(() => ({ confirmed: 0, waitlist: 0, capacity: m.capacity ?? 0, waiting_list: m.waiting_list ?? 0 }))
  );
  const availabilityResults = await Promise.all(availabilityPromises);

  let msg = `📋 <b>${onlyActive ? 'المهمات النشطة' : 'كل المهمات'}:</b>\n━━━━━━━━━━━━━━━━━\n\n`;
  
  for (let i = 0; i < missions.missions.length; i++) {
    const mission = missions.missions[i];
    const avail = availabilityResults[i];
    
    // Build inline keyboard for this mission
    const kb = missionListKeyboard(mission.id, mission.status ?? 'DRAFT');
    
    msg += formatMissionListItem(
      mission,
      avail.confirmed,
      avail.capacity,
      avail.waitlist,
      avail.waiting_list
    );
    
    if (i < missions.missions.length - 1) {
      msg += '\n\n';
    }
  }

  msg += `\n━━━━━━━━━━━━━━━━━\n💡 اختر مهمة للعرض التفصيلي 👇`;
  
  // Use missionPickerKeyboard with m:detail: prefix so clicking shows details
  await tgSend(token, chatId, msg, { reply_markup: missionPickerKeyboard(
    missions.missions.map(m => ({ id: m.id, public_code: m.public_code, title: m.title, status: m.status })),
    'm:detail'
  )});
}

// ─── Mission Stats ─────────────────────────────────────────────
export async function handleStats(token: string, chatId: number, db: D1Database): Promise<void> {
  const total = await db.prepare('SELECT COUNT(*) as c FROM missions').first() as any;
  const open = await db.prepare("SELECT COUNT(*) as c FROM missions WHERE status = 'OPEN'").first() as any;
  const regs = await db.prepare('SELECT COUNT(*) as c FROM registrations').first() as any;
  const confirmed = await db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'CONFIRMED'").first() as any;
  const waitlist = await db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'WAITLIST'").first() as any;
  const cancelled = await db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'CANCELLED'").first() as any;

  const stats = {
    totalMissions: total?.c ?? 0,
    openMissions: open?.c ?? 0,
    totalRegistrations: regs?.c ?? 0,
    confirmed: confirmed?.c ?? 0,
    waitlist: waitlist?.c ?? 0,
    cancelled: cancelled?.c ?? 0,
  };

  await tgSend(token, chatId, formatStats(stats), { 
    reply_markup: mainMenuKeyboard() 
  });
}

// ─── Mission Detail ────────────────────────────────────────────
export async function handleMissionDetail(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  try {
    const mission = await getMissionById(db, missionId);
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة أو تم حذفها.');
      return;
    }

    const status = mission.status ?? 'DRAFT';
    const availability = await getMissionAvailability(db, missionId);

    await tgSend(token, chatId, formatMissionDetail(mission, availability), {
      reply_markup: missionDetailKeyboard(missionId, status)
    });
  } catch (err: any) {
    console.error('[handleMissionDetail] Error:', err);
    await tgSend(token, chatId, 
      `❌ <b>خطأ في عرض التفاصيل:</b>\n<code>${err?.message || String(err)}</code>\n\nجرب /start`,
      { reply_markup: mainMenuKeyboard() }
    );
  }
}

// ─── Get Mission Link ──────────────────────────────────
export async function handleGetLink(token: string, chatId: number, db: D1Database, missionId: string): Promise<void> {
  try {
    const mission = await getMissionById(db, missionId);
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.');
      return;
    }

    const url = `https://red-crescent-minya.pages.dev/m/${mission.public_code}`;
    
    const kb = backToMissionKeyboard(missionId);
    await tgSend(token, chatId, 
      `🔗 <b>رابط التسجيل:</b>\n\n<code>${url}</code>`,
      { reply_markup: kb }
    );
  } catch (err: any) {
    console.error('[handleGetLink] Error:', err);
    await tgSend(token, chatId, `❌ خطأ في جلب الرابط: ${err?.message || String(err)}`, { reply_markup: mainMenuKeyboard() });
  }
}

// ─── WhatsApp Message ────────────────────────────
export async function handleWhatsAppMessage(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  try {
    const mission = await getMissionById(db, missionId);
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.');
      return;
    }

    const msg = buildWhatsAppMessage(mission);
    
    const kb = backToMissionKeyboard(missionId);
    await tgSend(token, chatId, 
      `📲 <b>رسالة الواتساب للمهمة ${mission.public_code}:</b>\n\n<code>${msg}</code>`,
      { reply_markup: kb }
    );
  } catch (err: any) {
    console.error('[handleWhatsAppMessage] Error:', err);
    await tgSend(token, chatId, `❌ خطأ في إرسال رسالة الواتساب: ${err?.message || String(err)}`, { reply_markup: mainMenuKeyboard() });
  }
}

// ─── Export CSV ──────────────────────────────────
export async function handleExportCSV(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  try {
    const mission = await getMissionById(db, missionId);
    if (!mission) {
      await tgSend(token, chatId, '❌ المهمة غير موجودة.');
      return;
    }

    // Fetch all registrations
    const regsResult = await db.prepare(
      `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
              r.created_at, v.member_id, v.name as volunteer_name, v.phone
       FROM registrations r
       JOIN volunteers v ON v.id = r.volunteer_id
       WHERE r.mission_id = ?
       ORDER BY r.registration_sequence ASC`
    ).bind(missionId).all();

    const regs = regsResult.results || [];
    
    // Build CSV
    const BOM = '\uFEFF';
    const headers = 'الترتيب,رقم العضوية,الاسم,رقم التليفون,الحالة,رقم المقعد,الموقع في الانتظار,تاريخ التسجيل\n';
    const rows = regs.map((r: any, idx: number) => {
      const statusAr = r.status === 'CONFIRMED' ? 'مؤكد' : r.status === 'WAITLIST' ? 'انتظار' : r.status === 'CANCELLED' ? 'ملغي' : 'قيد المراجعة';
      return `${idx + 1},"${r.member_id}","${r.volunteer_name}","${r.phone || ''}","${statusAr}","${r.seat_number || '-'}","${r.waitlist_position || '-'}","${new Date(r.created_at).toLocaleString('ar-EG')}"`;
    }).join('\n');

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

    const kb = backToMissionKeyboard(missionId);
    await tgSend(token, chatId, '✅ تم تصدير ملف CSV.', { reply_markup: kb });
  } catch (err: any) {
    console.error('[handleExportCSV] Error:', err);
    await tgSend(token, chatId, `❌ خطأ في تصدير CSV: ${err?.message || String(err)}`, { reply_markup: mainMenuKeyboard() });
  }
}