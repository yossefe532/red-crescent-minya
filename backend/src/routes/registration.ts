import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { generateRegistrationId, generateUUID, generateAudioKey } from '../utils/id';
import { logAudit } from '../services/audit.service';
import { InlineKeyboard } from 'grammy';

// ─── Telegram Notification Helpers ──────────────────────
async function sendTelegramVoice(
  token: string,
  chatId: number,
  fileId: string | null,
): Promise<boolean> {
  try {
    if (fileId) {
      await fetch(`https://api.telegram.org/bot${token}/sendVoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, voice: fileId }),
      }).catch(() => {});
      return true;
    }
    return false;
  } catch (e) {
    console.warn('[TELEGRAM_VOICE] Failed:', e);
    return false;
  }
}

async function sendRegistrationNotification(
  c: { env: Env },
  missionId: string,
  missionTitle: string,
  missionCode: string,
  volunteerName: string,
  volunteerMemberId: string,
  status: string,
  fileId: string | null,
): Promise<void> {
  const token = c.env.TELEGRAM_BOT_TOKEN;
  const adminChatIds = c.env.ADMIN_CHAT_IDS;
  if (!token || !adminChatIds) return;

  const chatIds = adminChatIds.split(',').map(s => s.trim()).filter(Boolean);
  const capText = `${missionCode} (${missionTitle})`;

  const kb = new InlineKeyboard();
  kb.text('🎙️ استمع للتسجيل', `voice:${missionId}:${status}`)
    .text('👋 رجوع', 'cancel:action')
    .row();

  const text = `🆕 <b>تسجيل متطوع جديد</b>\n\n`
    + `👤 <b>الاسم:</b> ${volunteerName}\n`
    + `🏷️ <b>رقم العضوية:</b> ${volunteerMemberId}\n`
    + `📋 <b>المهمة:</b> ${capText}\n`
    + `📊 <b>الحالة:</b> ${status}\n`
    + `${fileId ? '🎙️ <b>التسجيل الصوتي:</b>\n[Voice Message Attached]' : ''}\n`
    + `━━━━━━━━━━━━━━━━━\n`
    + `💡 اضغط على الزر للاستماع`;

  for (const chatId of chatIds) {
    const numId = parseInt(chatId, 10);
    if (isNaN(numId)) continue;
    await sendTelegramVoice(token, numId, fileId).catch(() => {});
    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: numId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      }).catch(() => {});
    } catch {}
  }
}

// ─── Telegram Notification Helper ──────────────────────────
// ─── Send Capacity Notifications ──────────────────────────────
async function sendCapacityNotifications(
  token: string | undefined,
  adminChatIds: string | undefined,
  data: {
    mission: { publicCode: string; title: string };
    newStatus: string;
    confirmedCount: number;
    capacity: number;
    waitlistCount: number;
    waitingList: number;
    name: string;
  }
): Promise<void> {
  if (!token || !adminChatIds) return;

  const chatId = adminChatIds.split(',')[0].trim();
  const { mission, newStatus, confirmedCount, capacity, waitlistCount, waitingList } = data;

  try {
    let text = '';
    let emoji = '';

    // CASE 1: Core capacity just reached (this registration was the last CONFIRMED spot)
    if (newStatus === 'CONFIRMED' && confirmedCount >= capacity && waitingList > 0) {
      emoji = '⚠️';
      text = `${emoji} *العدد الأساسي كتمل\\!*\n\n` +
        `المهمة: ${mission.title} \\(` + mission.publicCode + `\\)\n` +
        `العدد الأساسي: ${capacity} \\✅ مكتمل\n` +
        `انتظار: ${waitingList} مقعد متاح\n\n` +
        `تم فتح قائمة الانتظار\\. المتطوع الجديد هيبقى في الانتظار.`;
    }
    // CASE 2: Waitlist just filled
    else if (newStatus === 'WAITLIST' && waitlistCount >= waitingList) {
      emoji = '🔴';
      text = `${emoji} *العدد كتمل بالكامل\\!*\n\n` +
        `المهمة: ${mission.title} \\(` + mission.publicCode + `\\)\n` +
        `العدد الأساسي: ${capacity} \\✅\n` +
        `قائمة الانتظار: ${waitingList} \\✅ مكتملة\n\n` +
        `⚠️ لا يوجد مقاعد متاحة\\. التسجيل nuevos هيترفض.`;
    }
    // CASE 3: Mission fully complete (core + waitlist all filled)
    else if (newStatus === 'WAITLIST' && waitlistCount >= waitingList && confirmedCount >= capacity) {
      emoji = '🏆';
      text = `${emoji} *اكتملت المهمة بالكامل\\!*\n\n` +
        `المهمة: ${mission.title} \\(` + mission.publicCode + `\\)\n` +
        `العدد الأساسي: ${capacity}\\✅\n` +
        `الانتظار: ${waitingList}\\✅\n` +
        `الاجمالي: ${capacity + waitingList} متطوع\n\n` +
        `📊 لعرض الاحصاءات: /missions`;
    }

    if (text) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'MarkdownV2',
        }),
      });
      console.log(`[TELEGRAM] Capacity notification sent: ${emoji} ${newStatus}`);
    }
  } catch (e) {
    console.error('Failed to send capacity notification:', e);
  }
}

async function sendTelegramRegistrationNotification(
  token: string | undefined,
  adminChatIds: string | undefined,
  data: {
    registrationId: string;
    status: string;
    seatNumber: number | null;
    waitlistPosition: number | null;
    memberId: string;
    name: string;
    mission: { publicCode: string; title: string; capacity: number; waitingList: number };
    audioKey: string;
    audioBuffer: Uint8Array | null;
    mimeType: string;
    audioFileId?: string | null;
  }
): Promise<void> {
  if (!token || !adminChatIds) return;
  
  const chatId = adminChatIds.split(',')[0].trim();
  const { registrationId, status, seatNumber, waitlistPosition, memberId, name, mission, audioKey, audioBuffer, mimeType, audioFileId } = data;
  
  const statusEmoji = status === 'CONFIRMED' ? '✅' : '⏳';
  const text = `${statusEmoji} 🆕 تسجيل متطوع جديد\n\nالاسم: ${name}\nرقم العضوية: ${memberId}\nالمهمة: ${mission.title}\nالحالة: ${status}${seatNumber ? `\nرقم المقعد: ${seatNumber}` : ''}${waitlistPosition ? `\nرقم الانتظار: ${waitlistPosition}` : ''}\n\n🎙️ التسجيل الصوتي متاح`;

  try {
    // Send text notification with inline keyboard
    const kb = new InlineKeyboard();
    kb.text('🎙️ استمع للتسجيل', `voice:${mission.publicCode}:${status}`)
      .text('👋 رجوع', 'cancel:action')
      .row();

    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chat_id: chatId, 
        text, 
        parse_mode: 'HTML',
        reply_markup: kb,
      }),
    });
    
    // Try to fetch file_id from audio_confirmations if not provided
    let fileId = audioFileId || null;
    if (!fileId && audioBuffer && audioBuffer.length > 0) {
      // Audio is stored — get file_id from R2 (if available) or skip
      console.log('[TELEGRAM] Audio stored in R2/D1 but no file_id available');
    }
    
    // Send audio if available
    if (audioBuffer && audioBuffer.length > 0) {
      try {
        const base64Audio = btoa(String.fromCharCode.apply(null, Array.from(audioBuffer)));
        // Telegram allows max 50MB per audio file
        await fetch(`https://api.telegram.org/bot${token}/sendAudio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            audio: `data:${mimeType};base64,${base64Audio}`,
            caption: `🎙️ تسجيل ${name} - ${mission.title}`,
            duration: Math.floor(audioBuffer.length / 8000),
          }),
        });
      } catch (e) {
        console.warn('[TELEGRAM] Audio send failed (too large or format issue):', e);
      }
    }
  } catch (e) {
    console.error('Failed to send Telegram notification:', e);
  }
}

const publicRegistrationRoutes = new Hono<{ Bindings: Env }>();

/**
 * POST /api/register
 * Unified registration endpoint with mandatory voice recording.
 * Supports multipart/form-data or JSON (with base64 audio).
 */
publicRegistrationRoutes.post('/register', async (c) => {
  const startTime = Date.now();
  
  try {
    let member_id = '';
    let name = '';
    let phone = '';
    let mission_public_code = '';
    let phrase = '';
    let request_id = '';
    let audioBuffer: Uint8Array | null = null;
    let mimeType = 'audio/webm';
    let durationMs = 0;

    const contentType = c.req.header('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await c.req.formData();
      member_id = (formData.get('member_id') as string || '').trim();
      name = (formData.get('name') as string || '').trim();
      phone = (formData.get('phone') as string || '').trim();
      mission_public_code = (formData.get('mission_public_code') as string || '').trim();
      phrase = (formData.get('phrase') as string || '').trim();
      request_id = (formData.get('request_id') as string || '').trim();
      const durStr = formData.get('duration_ms') as string;
      if (durStr) durationMs = parseInt(durStr, 10) || 0;

      const audioFile = formData.get('audio') as File | null;
      if (audioFile && typeof audioFile !== 'string') {
        const arrayBuf = await audioFile.arrayBuffer();
        audioBuffer = new Uint8Array(arrayBuf);
        mimeType = audioFile.type || 'audio/webm';
      }
    } else {
      // JSON body
      const body = await c.req.json();
      member_id = (body.member_id || '').trim();
      name = (body.name || '').trim();
      phone = (body.phone || '').trim();
      mission_public_code = (body.mission_public_code || '').trim();
      phrase = (body.phrase || '').trim();
      request_id = (body.request_id || '').trim();
      durationMs = body.duration_ms || 0;
      mimeType = body.mime_type || 'audio/webm';

      if (body.audio_base64) {
        const cleanBase64 = body.audio_base64.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
        const binaryStr = atob(cleanBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        audioBuffer = bytes;
      }
    }

    // 1. Validate required text fields
    if (!mission_public_code) {
      return Errors.validation(c, [{ path: 'mission_public_code', message: 'كود المهمة مطلوب' }]);
    }
    if (!member_id) {
      return Errors.validation(c, [{ path: 'member_id', message: 'رقم العضوية مطلوب' }]);
    }
    if (!name) {
      return Errors.validation(c, [{ path: 'name', message: 'اسم المتطوع مطلوب' }]);
    }
    if (!phone) {
      return Errors.validation(c, [{ path: 'phone', message: 'رقم التليفون مطلوب للتواصل من المشرف وقت المهمة' }]);
    }
    // Validate Egyptian mobile number (01xxxxxxxxx = 11 digits, 010/011/012/015)
    if (!/^01[0125][0-9]{8}$/.test(phone)) {
      return Errors.validation(c, [{ 
        path: 'phone', 
        message: 'رقم التليفون غير صحيح. برجاء إدخال رقم موبايل مصري صالح (11 رقم يبدأ بـ 01)',
        code: 'INVALID_PHONE'
      }]);
    }

    if (name.length < 2 || name.length > 100) {
      return Errors.validation(c, [{ path: 'name', message: 'الاسم يجب أن يكون بين حرفين و 100 حرف' }]);
    }
    // Accept member_id from 1 character (allows 1, 2, 3, etc.)
    if (member_id.length < 1 || member_id.length > 50) {
      return Errors.validation(c, [{ path: 'member_id', message: 'رقم العضوية غير صحيح' }]);
    }

    // 2. MANDATORY AUDIO VALIDATION
    if (!audioBuffer || audioBuffer.byteLength < 500) {
      return Errors.validation(c, [{ 
        path: 'audio', 
        message: 'التسجيل الصوتي إلزامي لإتمام التسجيل. برجاء تسجيل العبارة بوضوح.',
        code: 'AUDIO_REQUIRED'
      }]);
    }

    if (audioBuffer.byteLength > 5 * 1024 * 1024) {
      return Errors.validation(c, [{ 
        path: 'audio', 
        message: 'حجم التسجيل الصوتي كبير جداً (أقصى حد 5 ميجابايت)',
        code: 'AUDIO_TOO_LARGE'
      }]);
    }

    // 3. Verify mission exists and is open
    const mission = await c.env.DB.prepare(
      `SELECT id, public_code, title, status, capacity, waiting_list, telegram_notifications, confirmation_phrase,
              registration_open_at, registration_close_at 
       FROM missions WHERE public_code = ?`
    ).bind(mission_public_code).first();

    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const missionData = mission as any;

    if (missionData.status !== 'OPEN') {
      return Errors.conflict(c, `التسجيل في هذه المهمة غير متاح حالياً (الحالة: ${missionData.status})`);
    }

    const nowIso = new Date().toISOString();
    if (missionData.registration_open_at && nowIso < missionData.registration_open_at) {
      return Errors.conflict(c, 'التسجيل لم يفتح بعد لهذه المهمة.');
    }
    if (missionData.registration_close_at && nowIso >= missionData.registration_close_at) {
      return Errors.conflict(c, 'تم إغلاق باب التسجيل لهذه المهمة.');
    }

    // 4. Idempotency Check (by request_id)
    if (request_id) {
      const existingAttempt = await c.env.DB.prepare(
        `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
                r.created_at, v.member_id, v.name as volunteer_name
         FROM registrations r
         JOIN volunteers v ON v.id = r.volunteer_id
         WHERE r.request_id = ?`
      ).bind(request_id).first();

      if (existingAttempt) {
        const ex = existingAttempt as any;
        return success(c, {
          registration_id: ex.id,
          status: ex.status,
          seat_number: ex.seat_number,
          waitlist_position: ex.waitlist_position,
          registration_sequence: ex.registration_sequence,
          created_at: ex.created_at,
          member_id: ex.member_id,
          name: ex.volunteer_name,
          idempotent_replay: true,
          message: ex.status === 'CONFIRMED'
            ? `تم تأكيد تسجيلك مسبقاً! رقم المقعد: ${ex.seat_number}`
            : `أنت مسجل مسبقاً في قائمة الانتظار برقم ${ex.waitlist_position}`,
        });
      }
    }

    // 5. Lookup or register volunteer (with phone)
    let volunteer = await c.env.DB.prepare(
      `SELECT id, member_id, name, phone FROM volunteers WHERE member_id = ?`
    ).bind(member_id).first();

    let volunteerId: string;
    let storedName = name;

    if (!volunteer) {
      volunteerId = generateUUID();
      await c.env.DB.prepare(
        `INSERT INTO volunteers (id, member_id, name, phone, created_at, updated_at) 
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(volunteerId, member_id, name, phone).run();
    } else {
      volunteerId = (volunteer as any).id;
      storedName = (volunteer as any).name || name;
      // Update phone if changed
      const oldPhone = (volunteer as any).phone;
      if (oldPhone !== phone) {
        await c.env.DB.prepare(
          `UPDATE volunteers SET phone = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(phone, volunteerId).run();
      }
    }

    // 6. Check duplicate registration for same mission (member_id based)
    const existingRegistration = await c.env.DB.prepare(
      `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence 
       FROM registrations r
       JOIN volunteers v ON v.id = r.volunteer_id
       WHERE r.mission_id = ? AND v.member_id = ?`
    ).bind(missionData.id, member_id).first();

    if (existingRegistration) {
      const ex = existingRegistration as any;
      if (ex.status === 'CONFIRMED' || ex.status === 'WAITLIST') {
        return c.json({
          success: false,
          error: {
            code: 'ALREADY_REGISTERED',
            message: ex.status === 'CONFIRMED'
              ? `أنت مسجل بالفعل في هذه المهمة ومقعدك رقم ${ex.seat_number}.`
              : `أنت مسجل بالفعل في قائمة الانتظار برقم ${ex.waitlist_position}.`,
            registration_id: ex.id,
            status: ex.status,
          }
        }, 409);
      }
    }

    // 7. Atomic Seat Allocation with Waiting List Support
    const counts = await c.env.DB.prepare(
      `SELECT 
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
         COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist,
         COUNT(*) as total
       FROM registrations WHERE mission_id = ?`
    ).bind(missionData.id).first();

    const countsData = counts as any;
    const confirmedCount = countsData?.confirmed || 0;
    const waitlistCount = countsData?.waitlist || 0;
    const capacity = missionData.capacity;
    const waitingList = missionData.waiting_list || 0;

    let newStatus = 'CONFIRMED';
    let seatNumber: number | null = null;
    let waitlistPosition: number | null = null;

    // Check if mission should be auto-closed
    const available = capacity - confirmedCount;
    const waitlistAvailable = waitingList > 0 ? (waitingList - waitlistCount) : 0;

    if (available > 0) {
      newStatus = 'CONFIRMED';
      seatNumber = confirmedCount + 1;
    } else if (waitingList > 0 && waitlistAvailable > 0) {
      newStatus = 'WAITLIST';
      waitlistPosition = waitlistCount + 1;
    } else {
      // No seats and no waiting list space - close the mission
      newStatus = 'REJECTED';
    }

    // Auto-close: if no more capacity and no waiting list space, mark mission as CLOSED
    if (newStatus === 'REJECTED' || (available <= 0 && waitingList === 0 && confirmedCount >= capacity)) {
      await c.env.DB.prepare(
        `UPDATE missions SET status = 'CLOSED', registration_close_at = datetime('now') WHERE id = ? AND status = 'OPEN'`
      ).bind(missionData.id).run();
      missionData.status = 'CLOSED';
    }

    // Get sequence number
    const seqResult = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(registration_sequence), 0) + 1 as next_seq FROM registrations WHERE mission_id = ?`
    ).bind(missionData.id).first();
    const nextSeq = (seqResult as any)?.next_seq || (confirmedCount + waitlistCount + 1);

    const registrationId = `${missionData.public_code}-REG-${String(nextSeq).padStart(6, '0')}`;
    const audioKey = generateAudioKey(missionData.public_code, registrationId);
    const usedPhrase = phrase || missionData.confirmation_phrase || `أؤكد مشاركتي في مهمة ${missionData.public_code}`;

    // 8. Store audio (R2 primary, D1 blob fallback)
    let audioStoredInR2 = false;
    try {
      await c.env.AUDIO_BUCKET.put(audioKey, audioBuffer, {
        httpMetadata: {
          contentType: mimeType,
        },
        customMetadata: {
          registration_id: registrationId,
          member_id: member_id,
          mission_code: missionData.public_code,
        }
      });
      audioStoredInR2 = true;
    } catch (storageErr) {
      console.error('R2 Audio upload failed, falling back to D1 blob:', storageErr);
    }

    // 9. Save registration in DB
    const confirmedAt = newStatus === 'CONFIRMED' ? new Date().toISOString() : null;
    await c.env.DB.prepare(
      `INSERT INTO registrations (
        id, mission_id, volunteer_id, status, seat_number, waitlist_position,
        registration_sequence, request_id, created_at, confirmed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).bind(
      registrationId,
      missionData.id,
      volunteerId,
      newStatus,
      seatNumber,
      waitlistPosition,
      nextSeq,
      request_id || null,
      confirmedAt
    ).run();

    // 10. Save audio confirmation record
    const audioId = generateUUID();
    const estDurationMs = durationMs || Math.max(2000, Math.floor(audioBuffer.byteLength / 8));
    // D1 does NOT support raw BLOB binds (turns them into CSV text), so store base64 text
    let audioB64: string | null = null;
    if (!audioStoredInR2 && audioBuffer) {
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < audioBuffer.length; i += chunk) {
        binary += String.fromCharCode.apply(null, Array.from(audioBuffer.subarray(i, i + chunk)));
      }
      audioB64 = btoa(binary);
    }
    await c.env.DB.prepare(
      `INSERT INTO audio_confirmations (
        id, registration_id, phrase, audio_key, duration_ms, mime_type, audio_data, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(audioId, registrationId, usedPhrase, audioKey, estDurationMs, mimeType, audioB64).run();

    // 11. Audit log
    await logAudit(c.env.DB, {
      actorId: volunteerId,
      actorType: 'volunteer',
      action: newStatus === 'CONFIRMED' ? 'REGISTRATION_CONFIRMED' : 'REGISTRATION_WAITLISTED',
      entityType: 'registration',
      entityId: registrationId,
      metadata: {
        mission_id: missionData.id,
        mission_public_code: missionData.public_code,
        member_id: member_id,
        name: storedName,
        seat_number: seatNumber,
        waitlist_position: waitlistPosition,
        status: newStatus,
        duration_ms: Date.now() - startTime,
      }
    });

    return success(c, {
      registration_id: registrationId,
      status: newStatus,
      seat_number: seatNumber,
      waitlist_position: waitlistPosition,
      registration_sequence: nextSeq,
      member_id: member_id,
      name: storedName,
      mission: {
        public_code: missionData.public_code,
        title: missionData.title,
        capacity: capacity,
        waiting_list: waitingList,
        confirmed: newStatus === 'CONFIRMED' ? confirmedCount + 1 : confirmedCount,
        available: Math.max(0, capacity - (newStatus === 'CONFIRMED' ? confirmedCount + 1 : confirmedCount)),
        waitlist_available: Math.max(0, (waitingList || 0) - waitlistCount),
        telegram_notifications: missionData.telegram_notifications,
      },
      message: newStatus === 'CONFIRMED' 
        ? `تم تأكيد تسجيلك بنجاح! رقم مقعدك: ${seatNumber}`
        : newStatus === 'WAITLIST'
          ? `اكتملت المقاعد المتاحة. تم إضافتك إلى قائمة الانتظار برقم: ${waitlistPosition}`
          : `عذراً، تم الوصول للسعة القصوى لهذه المهمة. التسجيل مغلق.`,
    }, 201);

    // 12. Send Telegram notification if enabled and status is CONFIRMED or WAITLIST
    if (missionData.telegram_notifications === 1 && (newStatus === 'CONFIRMED' || newStatus === 'WAITLIST')) {
      // Fire-and-forget notification (don't await to avoid blocking response)
      sendTelegramRegistrationNotification(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.ADMIN_CHAT_IDS,
        {
          registrationId,
          status: newStatus,
          seatNumber,
          waitlistPosition,
          memberId: member_id,
          name: storedName,
          mission: {
            publicCode: missionData.public_code,
            title: missionData.title,
            capacity,
            waitingList,
          },
          audioKey,
          audioBuffer,
          mimeType,
          audioFileId: audioStoredInR2 ? audioKey : null, // If stored in R2, we have the key
        }
      ).catch(err => console.error('Telegram notification failed:', err));
    }

    // 13. Send capacity notifications (core reached / waitlist full / mission complete)
    if (missionData.telegram_notifications === 1) {
      sendCapacityNotifications(
        c.env.TELEGRAM_BOT_TOKEN,
        c.env.ADMIN_CHAT_IDS,
        {
          mission: { publicCode: missionData.public_code, title: missionData.title },
          newStatus,
          confirmedCount: newStatus === 'CONFIRMED' ? confirmedCount + 1 : confirmedCount,
          capacity,
          waitlistCount: newStatus === 'WAITLIST' ? waitlistCount + 1 : waitlistCount,
          waitingList: waitingList || 0,
          name: storedName,
        }
      ).catch(err => console.error('Capacity notification failed:', err));
    }

  } catch (err: any) {
    console.error('Registration error:', err);
    // Handle SQL unique constraint violations gracefully
    if (err?.message?.includes('UNIQUE constraint failed')) {
      return c.json({
        success: false,
        error: {
          code: 'ALREADY_REGISTERED',
          message: 'أنت مسجل بالفعل في هذه المهمة.',
        }
      }, 409);
    }
    return Errors.internal(c);
  }
});

// GET /api/register/status/:registrationId - Public status check for volunteer
publicRegistrationRoutes.get('/register/status/:registrationId', async (c) => {
  try {
    const registrationId = c.req.param('registrationId');
    
    const result = await c.env.DB.prepare(`
      SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
             r.created_at, r.confirmed_at,
             v.member_id, v.name as volunteer_name,
             m.public_code, m.title as mission_title, m.capacity
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      JOIN missions m ON m.id = r.mission_id
      WHERE r.id = ?
    `).bind(registrationId).first();
    
    if (!result) {
      return Errors.notFound(c, 'Registration');
    }
    
    const regData = result as any;
    
    return success(c, {
      id: regData.id,
      status: regData.status,
      seat_number: regData.seat_number,
      waitlist_position: regData.waitlist_position,
      registration_sequence: regData.registration_sequence,
      created_at: regData.created_at,
      confirmed_at: regData.confirmed_at,
      volunteer: {
        member_id: regData.member_id,
        name: regData.volunteer_name,
      },
      mission: {
        public_code: regData.public_code,
        title: regData.mission_title,
        capacity: regData.capacity,
      }
    });
  } catch (err: any) {
    console.error('Get registration status error:', err);
    return Errors.internal(c);
  }
});

export { publicRegistrationRoutes };
