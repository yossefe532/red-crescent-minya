/**
 * Telegram Bot — Cancel Registration Handler
 * Wizard-based registration cancellation
 */
import { WizardState, WizardData } from '../types';
import { tgSend, tgEdit, tgAnswerCb, tgSendVoice, tgSendDocument, isAuthorizedChat, getSession, setSession, clearSession, escapeHtml } from '../bot';
import { statusLabel, regStatusLabel, formatDate, formatDateShort, formatMissionDetail, formatMissionListItem, formatVolunteerDetail, formatRegistrationNotification, formatStats, formatHealth, helpText, buildWhatsAppMessage, formatCreateSummary } from '../formatters';
import { mainMenuKeyboard, missionListKeyboard, missionDetailKeyboard, volunteerActionsKeyboard, skipButtonKeyboard, cancelWizardKeyboard, createConfirmKeyboard, confirmActionKeyboard, editFieldKeyboard, notificationSettingsKeyboard, backToMissionKeyboard, backToHomeKeyboard, missionPickerKeyboard } from '../keyboards';
import { getMissionById, getMissionByPublicCode, listMissions } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';
import { InlineKeyboard } from 'grammy';

// ─── Helper Functions (should be moved to a service) ────────────
async function getVolunteerByMemberId(db: D1Database, memberId: string): Promise<any | null> {
  return await db.prepare(
    'SELECT id, member_id, name, phone FROM volunteers WHERE member_id = ?'
  ).bind(memberId).first();
}

async function getRegistrationById(db: D1Database, regId: string): Promise<any | null> {
  return await db.prepare(
    `SELECT r.id, r.mission_id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
            r.created_at, r.confirmed_at, r.cancelled_at,
            v.member_id, v.name as volunteer_name, v.phone,
            m.id as mission_id, m.public_code, m.title as mission_title
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     JOIN missions m ON r.mission_id = m.id
     WHERE r.id = ?`
  ).bind(regId).first();
}

async function updateRegistrationStatus(
  db: D1Database,
  regId: string,
  status: string,
  seatNumber: number | null,
  waitlistPosition: number | null,
  confirmedAt: string | null,
  cancelledAt: string | null
): Promise<void> {
  await db.prepare(
    `UPDATE registrations SET 
        status = ?, 
        seat_number = ?, 
        waitlist_position = ?, 
        confirmed_at = ?, 
        cancelled_at = ?,
        updated_at = datetime('now')
     WHERE id = ?`
  ).bind(status, seatNumber, waitlistPosition, confirmedAt, cancelledAt, regId).run();
}

// ─── Start Cancel Wizard ───────────────────────────────────────
export async function startCancelWizard(
  token: string,
  chatId: number,
  db: D1Database,
  hint: string | undefined = undefined
): Promise<void> {
  // We need to let the admin choose a mission first, then a volunteer
  // We'll store the missionId in the session when they pick a mission
  if (hint) {
    // Try to find mission by hint
    const mission = await getMissionByHint(db, hint);
    if (mission) {
      // Store mission in session and go to volunteer selection
      await setSession(db, chatId, 'cancelreg_select_mission', { missionId: mission.id, missionCode: mission.public_code, title: mission.title });
      await showVolunteerListForMission(token, chatId, db, mission.id);
      return;
    }
  }

  // Show mission picker
  const missions = await listMissions(db, { limit: 10, offset: 0, status: 'OPEN' }); // Only show open missions? Or all? We'll show all non-cancelled/completed?
  // Actually, we can cancel registration from any mission that is not deleted, but we'll show missions that have registrations.
  // For simplicity, we'll show all missions.
  if (!missions.missions.length) {
    await tgSend(token, chatId, '📋 لا توجد مهمات.');
    return;
  }

  await setSession(db, chatId, 'cancelreg_select_mission', {}); // We'll fill missionId in the picker
  await tgSend(token, chatId,
    '🗑️ <b>اختر المهمة لإلغاء تسجيل متطوع منها:</b>',
    { reply_markup: missionPickerKeyboard(
      missions.missions.map(m => ({ id: m.id, public_code: m.public_code, title: m.title, status: m.status })),
      'cancelreg:mission'
    ) }
  );
}

async function getMissionByHint(db: D1Database, hint: string): Promise<any | null> {
  // Try by public_code (MNY-XXX)
  const codeMatch = hint.match(/MNY-?(\\d+)/i);
  if (codeMatch) {
    const mission = await getMissionByPublicCode(db, `MNY-${codeMatch[1]}`);
    if (mission) return mission;
  }

  // Try by ID (UUID)
  const mission = await getMissionById(db, hint);
  if (mission) return mission;

  // Try by title (exact match first, then partial)
  const missions = await listMissions(db, { limit: 10, offset: 0 });
  const exact = missions.missions.find(m => m.title.trim().toLowerCase() === hint.trim().toLowerCase());
  if (exact) return exact;

  const partial = missions.missions.find(m => 
    m.title.trim().toLowerCase().includes(hint.trim().toLowerCase())
  );
  return partial || null;
}

// ─── Show Volunteer List for a Mission ─────────────────────────
export async function showVolunteerListForMission(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    await clearSession(db, chatId);
    return;
  }

  // Fetch registrations for this mission (excluding cancelled)
  const regsResult = await db.prepare(
    `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.created_at,
            v.member_id, v.name as volunteer_name, v.phone
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     WHERE r.mission_id = ? AND r.status != 'CANCELLED'
     ORDER BY r.registration_sequence ASC`
  ).bind(missionId).all();

  const regs = regsResult.results || [];

  if (!regs.length) {
    await tgSend(token, chatId, `📋 لا يوجد مسجلين في <b>${mission.title}</b>`, {
      reply_markup: backToHomeKeyboard()
    });
    await clearSession(db, chatId);
    return;
  }

  let msg = `👥 <b>مسجلو ${mission.title} (${mission.public_code})</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;

  regs.forEach((r: any, idx) => {
    const statusIcon = r.status === 'CONFIRMED' ? '✅' : '⏳';
    msg += `  ${idx + 1}. ${statusIcon} ${r.volunteer_name} (${r.member_id})\n`;
    msg += `     🕐 ${formatDate(r.created_at)}\n`;
  });

  // Build keyboard for each volunteer (limit to 10)
  const kb = new InlineKeyboard();
  regs.slice(0, 10).forEach((r: any, idx) => {
    const label = r.status === 'CONFIRMED' ? `✅ ${r.volunteer_name}` : `⏳ ${r.volunteer_name}`;
    kb.text(label, `cancelreg:vol:${r.id}`).row();
  });
  if (regs.length > 10) {
    kb.text(`... و ${regs.length - 10} آخرين`, 'noop').row();
  }
  kb.text('🔙 رجوع لاختيار مهمة', 'cancelreg:back');
  kb.text('❌ إلغاء', 'wiz:cancel');

  await tgSend(token, chatId, msg, { reply_markup: kb });
}

// ─── Handle Mission Picker for Cancel Wizard ───────────────────
export async function handleCancelMissionPick(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    await clearSession(db, chatId);
    return;
  }

  // Store mission in session and show volunteer list
  await setSession(db, chatId, 'cancelreg_select_mission', { missionId: mission.id, missionCode: mission.public_code, title: mission.title });
  await showVolunteerListForMission(token, chatId, db, missionId);
}

// ─── Handle Volunteer Selection ────────────────────────────────
export async function handleCancelVolunteerSelect(
  token: string,
  chatId: number,
  db: D1Database,
  regId: string
): Promise<void> {
  const session = await getSession(db, chatId);
  if (session.state !== 'cancelreg_select_volunteer') {
    // We expect to be in the volunteer selection state
    await tgSend(token, chatId, '❌ حدث خطأ. يرجى البدء من جديد.');
    await clearSession(db, chatId);
    return;
  }

  const reg = await getRegistrationById(db, regId);
  if (!reg) {
    await tgSend(token, chatId, '❌ التسجيل غير موجود.');
    return;
  }

  // Store registration data in session and ask for confirmation
  await setSession(db, chatId, 'cancelreg_confirm', {
    missionId: reg.mission_id,
    missionCode: reg.mission_code,
    regId: reg.id,
    volunteerName: reg.volunteer_name,
    memberId: reg.member_id,
    status: reg.status
  });

  await tgSend(token, chatId,
    `⚠️ <b>تأكيد إلغاء التسجيل</b>\n\n` +
    `👤 <b>الاسم:</b> ${reg.volunteer_name}\n` +
    `🏷️ <b>رقم العضوية:</b> ${reg.member_id}\n` +
    `📋 <b>المهمة:</b> ${reg.mission_title} (${reg.mission_code})\n` +
    `📊 <b>الحالة:</b> ${regStatusLabel(reg.status)}\n\n` +
    `هل أنت متأكد من إلغاء هذا التسجيل؟`,
    { reply_markup: confirmActionKeyboard('cancelreg', reg.id) }
  );
}

// ─── Execute Cancel Registration ───────────────────────────────
export async function executeCancelRegistration(
  token: string,
  chatId: number,
  db: D1Database,
  regId: string
): Promise<void> {
  // Fetch the registration to get mission_id and volunteer info
  const reg = await getRegistrationById(db, regId);
  if (!reg) {
    await tgSend(token, chatId, '❌ التسجيل غير موجود.');
    return;
  }

  // Check if already cancelled
  if (reg.status === 'CANCELLED') {
    await tgSend(token, chatId, 'ℹ️ هذا التسجيل ملغي بالفعل.');
    await clearSession(db, chatId);
    return;
  }

  try {
    // Step 1: Cancel the registration
    await updateRegistrationStatus(
      db,
      regId,
      'CANCELLED',
      null, // seat_number
      null, // waitlist_position
      null, // confirmed_at
      new Date().toISOString() // cancelled_at
    );

    // Step 2: If it was a confirmed seat, promote the first waitlist volunteer
    let promotedVolunteer = null;
    if (reg.status === 'CONFIRMED' && reg.seat_number !== null) {
      // Find the first waitlist volunteer for this mission
      const waitlistResult = await db.prepare(
        `SELECT r.id, r.waitlist_position, v.name as volunteer_name, v.member_id
         FROM registrations r
         JOIN volunteers v ON v.id = r.volunteer_id
         WHERE r.mission_id = ? AND r.status = 'WAITLIST'
         ORDER BY r.waitlist_position ASC
         LIMIT 1`
      ).bind(reg.mission_id).first();

      const waitlistReg = waitlistResult as any;
      if (waitlistReg) {
        // Promote this waitlist volunteer to confirmed
        const newSeatNumber = reg.seat_number; // Take the seat that was just freed
        await updateRegistrationStatus(
          db,
          waitlistReg.id,
          'CONFIRMED',
          newSeatNumber,
          null, // waitlist_position
          new Date().toISOString(), // confirmed_at
          null // cancelled_at
        );

        // Reorder the remaining waitlist: decrement waitlist_position by 1 for those after the promoted one
        await db.prepare(
          `UPDATE registrations SET waitlist_position = waitlist_position - 1
           WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`
        ).bind(reg.mission_id, waitlistReg.waitlist_position).run();

        promotedVolunteer = {
          name: waitlistReg.volunteer_name,
          memberId: waitlistReg.member_id,
          newSeatNumber: newSeatNumber
        };
      }
    }

    // Log audit
    await logAudit(db, {
      actorId: 'telegram', // TODO: get actual admin ID from session
      actorType: 'admin',
      action: 'REGISTRATION_CANCELLED',
      entityType: 'registration',
      entityId: regId,
      metadata: { 
        missionId: reg.mission_id,
        seatNumber: reg.seat_number,
        promotedVolunteer: promotedVolunteer ? {
          name: promotedVolunteer.name,
          memberId: promotedVolunteer.memberId,
          newSeatNumber: promotedVolunteer.newSeatNumber
        } : null
      }
    });

    // Clear session
    await clearSession(db, chatId);

    // Success message
    let msg = `✅ <b>تم إلغاء التسجيل بنجاح!</b>\n\n`;
    msg += `👤 المتطوع: ${reg.volunteer_name} (${reg.member_id})\n`;
    msg += `📋 المهمة: ${reg.mission_title} (${reg.mission_code})\n`;
    if (promotedVolunteer) {
      msg += `🔼 تم ترقية ${promotedVolunteer.name} (${promotedVolunteer.memberId}) إلى المقعد رقم ${promotedVolunteer.newSeatNumber}.\n`;
    }

    await tgSend(token, chatId, msg, {
      reply_markup: mainMenuKeyboard()
    });
  } catch (error: any) {
    console.error('Cancel registration failed:', error);
    await tgSend(token, chatId, `❌ فشل إلغاء التسجيل: ${error.message}`, {
      reply_markup: mainMenuKeyboard()
    });
  }
}

// ─── Handle Confirmation for Cancel Wizard ─────────────────────
export async function handleCancelRegConfirm(
  token: string,
  chatId: number,
  db: D1Database,
  regId: string
): Promise<void> {
  await executeCancelRegistration(token, chatId, db, regId);
}