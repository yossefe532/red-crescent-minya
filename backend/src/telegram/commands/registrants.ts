/**
 * Telegram Bot — Registrants Handler
 * View registrants, waitlist, volunteer details, audio, status moves.
 * Uses ONLY existing services — no duplicate business logic.
 */
import { tgSend, tgSendVoice, escapeHtml } from '../bot';
import {
  formatDate, formatVolunteerDetail, regStatusLabel, statusLabel,
} from '../formatters';
import {
  backToMissionKeyboard, backToHomeKeyboard, mainMenuKeyboard,
  volunteerActionsKeyboard,
} from '../keyboards';
import { getMissionById, getMissionAvailability } from '../../services/mission.service';
import { logAudit } from '../../services/audit.service';

// ─── Show Registrants ──────────────────────────────────────────
export async function handleRegistrants(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    return;
  }

  const regsResult = await db.prepare(
    `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.created_at,
            v.member_id, v.name as volunteer_name, v.phone,
            CASE WHEN ac.id IS NOT NULL THEN 1 ELSE 0 END as has_audio
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     LEFT JOIN audio_confirmations ac ON ac.registration_id = r.id
     WHERE r.mission_id = ? AND r.status != 'CANCELLED'
     ORDER BY r.registration_sequence ASC`
  ).bind(missionId).all();

  const regs = regsResult.results || [];

  if (!regs.length) {
    await tgSend(token, chatId, `📋 لا يوجد مسجلين في <b>${mission.title}</b>`, {
      reply_markup: backToMissionKeyboard(missionId)
    });
    return;
  }

  const confirmed = regs.filter(r => r.status === 'CONFIRMED');
  const waitlist = regs.filter(r => r.status === 'WAITLIST');

  let msg = `👥 <b>مسجلو ${mission.title} (${mission.public_code})</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;

  if (confirmed.length) {
    msg += `✅ <b>مؤكدون (${confirmed.length}):</b>\n`;
    confirmed.forEach((r: any, i) => {
      const audioIcon = r.has_audio ? '🎙️' : '';
      msg += `  ${i + 1}. ${audioIcon} ${r.volunteer_name} (${r.member_id})\n`;
      msg += `     🕐 ${formatDate(r.created_at)}\n`;
    });
    msg += '\n';
  }

  if (waitlist.length) {
    msg += `⏳ <b>قائمة الانتظار (${waitlist.length}):</b>\n`;
    waitlist.forEach((r: any, i) => {
      const audioIcon = r.has_audio ? '🎙️' : '';
      msg += `  #${r.waitlist_position || '?'} — ${audioIcon} ${r.volunteer_name} (${r.member_id})\n`;
      msg += `     🕐 ${formatDate(r.created_at)}\n`;
    });
  }

  // Inline keyboard with limited volunteer buttons (avoid too many)
  const kb = { inline_keyboard: [] as any[][] };
  const displayRegs = regs.slice(0, 10);
  displayRegs.forEach(r => {
    const label = r.status === 'CONFIRMED' ? `✅ ${r.volunteer_name}` : `⏳ ${r.volunteer_name}`;
    kb.inline_keyboard.push([{ text: label, callback_data: `v:detail:${r.id}` }]);
  });
  if (regs.length > 10) {
    kb.inline_keyboard.push([{ text: `... و ${regs.length - 10} آخرين`, callback_data: 'noop' }]);
  }
  kb.inline_keyboard.push([{ text: '🔙 القائمة الرئيسية', callback_data: 'nav:home' }]);

  await tgSend(token, chatId, msg, { reply_markup: kb });
}

// ─── Show Waitlist ─────────────────────────────────────────────
export async function handleWaitlist(
  token: string,
  chatId: number,
  db: D1Database,
  missionId: string
): Promise<void> {
  const mission = await getMissionById(db, missionId);
  if (!mission) {
    await tgSend(token, chatId, '❌ المهمة غير موجودة.');
    return;
  }

  const regsResult = await db.prepare(
    `SELECT r.id, r.waitlist_position, r.created_at,
            v.member_id, v.name as volunteer_name, v.phone,
            CASE WHEN ac.id IS NOT NULL THEN 1 ELSE 0 END as has_audio
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     LEFT JOIN audio_confirmations ac ON ac.registration_id = r.id
     WHERE r.mission_id = ? AND r.status = 'WAITLIST'
     ORDER BY r.waitlist_position ASC`
  ).bind(missionId).all();

  const regs = regsResult.results || [];

  if (!regs.length) {
    await tgSend(token, chatId, `⏳ لا يوجد أحد في قائمة الانتظار لـ <b>${mission.title}</b>`, {
      reply_markup: backToMissionKeyboard(missionId)
    });
    return;
  }

  let msg = `⏳ <b>قائمة الانتظار — ${mission.title}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━\n\n`;

  regs.forEach((r: any, idx) => {
    const audioIcon = r.has_audio ? '🎙️' : '';
    msg += `#${r.waitlist_position || '?'} — ${audioIcon} ${r.volunteer_name} (${r.member_id})\n`;
    msg += `     🕐 ${formatDate(r.created_at)}\n`;
  });

  const kb = { inline_keyboard: [] as any[][] };
  regs.slice(0, 10).forEach((r: any) => {
    kb.inline_keyboard.push([{ text: `${r.volunteer_name}`, callback_data: `v:detail:${r.id}` }]);
  });
  if (regs.length > 10) {
    kb.inline_keyboard.push([{ text: `... و ${regs.length - 10} آخرين`, callback_data: 'noop' }]);
  }
  kb.inline_keyboard.push([{ text: '🔙 القائمة الرئيسية', callback_data: 'nav:home' }]);

  await tgSend(token, chatId, msg, { reply_markup: kb });
}

// ─── Volunteer Detail ──────────────────────────────────────────
export async function handleVolunteerDetail(
  token: string,
  chatId: number,
  db: D1Database,
  regId: string
): Promise<void> {
  const regResult = await db.prepare(
    `SELECT r.id, r.status, r.waitlist_position, r.seat_number, r.created_at,
            v.member_id, v.name as volunteer_name, v.phone,
            m.id as mission_id, m.title, m.public_code, m.status as mission_status,
            ac.id as audio_id, ac.duration_ms, ac.mime_type
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     JOIN missions m ON r.mission_id = m.id
     LEFT JOIN audio_confirmations ac ON ac.registration_id = r.id
     WHERE r.id = ?`
  ).bind(regId).first();

  const reg = regResult as any;
  if (!reg) {
    await tgSend(token, chatId, '❌ التسجيل غير موجود.');
    return;
  }

  const hasAudio = !!reg.audio_id;
  const audioDurationSec = reg.duration_ms ? Math.round(reg.duration_ms / 1000) : 0;

  await tgSend(token, chatId, formatVolunteerDetail(reg, hasAudio, audioDurationSec), {
    reply_markup: volunteerActionsKeyboard(regId, reg.mission_id, reg.status, hasAudio)
  });
}

// ─── Volunteer Audio Sender ────────────────────────────────────
export async function handleVolunteerAudio(
  token: string,
  chatId: number,
  db: D1Database,
  regId: string
): Promise<void> {
  const audioResult = await db.prepare(
    `SELECT ac.audio_data, ac.duration_ms, ac.mime_type,
            v.name, v.member_id, m.title, m.public_code
     FROM audio_confirmations ac
     JOIN registrations r ON ac.registration_id = r.id
     JOIN volunteers v ON v.id = r.volunteer_id
     JOIN missions m ON r.mission_id = m.id
     WHERE ac.registration_id = ?`
  ).bind(regId).first();

  const audio = audioResult as any;
  if (!audio || !audio.audio_data) {
    await tgSend(token, chatId, '❌ لا يوجد تسجيل صوتي محفوظ.');
    return;
  }

  let bytes: Uint8Array;
  try {
    const b64 = audio.audio_data.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
    const binaryStr = atob(b64);
    bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
  } catch (e) {
    console.error('base64 decode failed:', e);
    await tgSend(token, chatId, '❌ فشل فك تشفير الصوت.');
    return;
  }

  const mime = audio.mime_type || 'audio/webm';
  const durationSec = Math.round((audio.duration_ms || 0) / 1000);

  await tgSend(token, chatId,
    `🎙️ <b>تسجيل المتطوع</b>\n\n` +
    `👤 <b>الاسم:</b> ${escapeHtml(audio.name)}\n` +
    `🏷️ <b>العضوية:</b> ${audio.member_id}\n` +
    `📋 <b>المهمة:</b> ${escapeHtml(audio.title)} (${audio.public_code})\n` +
    `⏱️ <b>المدة:</b> ${durationSec} ثانية\n\n` +
    `📥 جاري إرسال التسجيل...`
  );

  const success = await tgSendVoice(
    token,
    chatId,
    bytes,
    mime,
    `🎙️ تسجيل ${audio.name} - ${audio.title}`,
    durationSec
  );

  if (!success) {
    await tgSend(token, chatId,
      `❌ فشل إرسال الصوت في التليجرام.\n` +
      `يمكنك الاستماع من لوحة التحكم:\nhttps://red-crescent-minya.pages.dev/admin`,
      { reply_markup: backToHomeKeyboard() }
    );
  } else {
    await tgSend(token, chatId, '✅ تم إرسال التسجيل بنجاح.', {
      reply_markup: backToHomeKeyboard()
    });
  }
}

// ─── Volunteer Status Move (CONFIRMED <-> WAITLIST) ────────────
export async function handleVolunteerMove(
  token: string,
  chatId: number,
  db: D1Database,
  regId: string,
  targetStatus: 'CONFIRMED' | 'WAITLIST'
): Promise<void> {
  const regResult = await db.prepare(
    `SELECT r.id, r.status, r.seat_number, r.waitlist_position, v.name, m.title, m.public_code, m.id as mission_id
     FROM registrations r
     JOIN volunteers v ON v.id = r.volunteer_id
     JOIN missions m ON r.mission_id = m.id
     WHERE r.id = ?`
  ).bind(regId).first();

  const reg = regResult as any;
  if (!reg) {
    await tgSend(token, chatId, '❌ التسجيل غير موجود.');
    return;
  }

  if (reg.status === targetStatus) {
    await tgSend(token, chatId,
      `ℹ️ المتطوع <b>${escapeHtml(reg.name)}</b> بالفعل ${targetStatus === 'CONFIRMED' ? 'مؤكد' : 'في قائمة الانتظار'}.`);
    return;
  }

  // Check availability before moving
  const availability = await getMissionAvailability(db, reg.mission_id);

  // ── Moving to CONFIRMED ──
  if (targetStatus === 'CONFIRMED') {
    if (availability.available <= 0) {
      await tgSend(token, chatId, '❌ لا يمكن تأكيد المتطوع: لا يوجد مقعد شاغر.');
      return;
    }

    const newSeat = availability.confirmed + 1;

    await db.prepare(
      `UPDATE registrations
       SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now')
       WHERE id = ?`
    ).bind(newSeat, regId).run();

    // Decrement waitlist positions of those after this volunteer
    if (reg.waitlist_position) {
      await db.prepare(
        `UPDATE registrations SET waitlist_position = waitlist_position - 1
         WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`
      ).bind(reg.mission_id, reg.waitlist_position).run();
    }

    await logAudit(db, {
      actorId: 'telegram',
      actorType: 'admin',
      action: 'VOLUNTEER_CONFIRMED',
      entityType: 'registration',
      entityId: regId,
      metadata: { missionId: reg.mission_id, seatNumber: newSeat }
    });

    await tgSend(token, chatId,
      `✅ تأكيد المتطوع <b>${escapeHtml(reg.name)}</b> في مهمة <b>${escapeHtml(reg.title)}</b> (${reg.public_code})\n💺 المقعد: ${newSeat}`,
      { reply_markup: volunteerActionsKeyboard(regId, reg.mission_id, 'CONFIRMED', false) }
    );
    return;
  }

  // ── Moving to WAITLIST ──
  if (targetStatus === 'WAITLIST') {
    if (availability.waitlist_available <= 0) {
      await tgSend(token, chatId, '❌ لا يمكن نقل المتطوع للانتظار: قائمة الانتظار ممتلئة.');
      return;
    }

    const newWaitlistPos = availability.waitlist + 1;

    await db.prepare(
      `UPDATE registrations
       SET status = 'WAITLIST', waitlist_position = ?, seat_number = NULL
       WHERE id = ?`
    ).bind(newWaitlistPos, regId).run();

    // Free the seat — promote first waitlisted if any (but we just moved someone TO waitlist,
    // so there's now an empty seat; if there are OTHER waitlisted, promote the first one)
    if (reg.seat_number) {
      const next = await db.prepare(
        `SELECT r.id FROM registrations r
         WHERE r.mission_id = ? AND r.status = 'WAITLIST' AND r.id != ?
         ORDER BY r.waitlist_position ASC LIMIT 1`
      ).bind(reg.mission_id, regId).first() as any;

      if (next) {
        await db.prepare(
          `UPDATE registrations SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now')
           WHERE id = ?`
        ).bind(reg.seat_number, next.id).run();

        await db.prepare(
          `UPDATE registrations SET waitlist_position = waitlist_position - 1
           WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`
        ).bind(reg.mission_id, reg.waitlist_position || 0).run(); // adjust positions
      }
    }

    await logAudit(db, {
      actorId: 'telegram',
      actorType: 'admin',
      action: 'VOLUNTEER_WAITLISTED',
      entityType: 'registration',
      entityId: regId,
      metadata: { missionId: reg.mission_id, waitlistPosition: newWaitlistPos }
    });

    await tgSend(token, chatId,
      `⏳ تحويل <b>${escapeHtml(reg.name)}</b> للانتظار في مهمة <b>${escapeHtml(reg.title)}</b> (${reg.public_code})\n⏳ رقم الانتظار: ${newWaitlistPos}`,
      { reply_markup: volunteerActionsKeyboard(regId, reg.mission_id, 'WAITLIST', false) }
    );
    return;
  }
}