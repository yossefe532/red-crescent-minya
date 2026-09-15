import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { generateRegistrationId, generateUUID, generateAudioKey } from '../utils/id';
import { logAudit } from '../services/audit.service';
import { createNotificationEvent, processPendingNotifications } from '../services/notification_outbox';
import { getOwnershipToken } from '../middleware/ownership';
import { incrementMissionVersion } from '../utils/version';
import { InlineKeyboard } from 'grammy';
import { getMissionRequirements, getMissionQuestions, saveRegistrationAnswers } from '../services/mission.requirements.service';
import { SQL_NOW_ISO } from '../config/timezone';

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

// ─── Notification Helper (voice-delivery only) ─────────────
// Registration notifications are now durable via the outbox (notification_events).
// The legacy sendCapacityNotifications and sendTelegramRegistrationNotification
// were dead code (they ran after `return`) and have been removed.

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
    let parsedBody: any = null; // Cached JSON body for requirement/answer extraction

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
      parsedBody = body; // Cache for later use (requirement/answers)

      if (body.audio_blob) {
        const cleanBase64 = body.audio_blob.replace(/^data:audio\/[a-z0-9]+;base64,/, '');
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

    // 4. Requirement & Question Validation
    let requirementAccepted = false;
    let answers: Array<{ question_id: string; answer_text: string }> = [];

    // Parse requirement acceptance and answers from request
    if (contentType.includes('multipart/form-data')) {
      // Already parsed above — get from form data
      const formData = await c.req.formData();
      requirementAccepted = formData.get('requirement_accepted') === 'true';
      const answersStr = formData.get('answers') as string;
      if (answersStr) {
        try { answers = JSON.parse(answersStr); } catch {}
      }
    } else {
      // JSON body — use cached parse from above
      requirementAccepted = parsedBody.requirement_accepted === true;
      if (Array.isArray(parsedBody.answers)) {
        answers = parsedBody.answers;
      }
    }

    // 4a. Validate requirements
    const requirements = await getMissionRequirements(c.env.DB, missionData.id);
    const hasRequiredRequirement = requirements.some(r => r.requires_acceptance === 1);
    if (hasRequiredRequirement && !requirementAccepted) {
      return Errors.validation(c, [{
        path: 'requirement_accepted',
        message: 'يجب الموافقة على شروط المهمة لإتمام التسجيل',
        code: 'REQUIREMENT_NOT_ACCEPTED',
      }]);
    }

    // 4b. Validate questions
    const questions = await getMissionQuestions(c.env.DB, missionData.id);
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const validationErrors: Array<{ path: string; message: string; code?: string }> = [];

    for (const q of questions) {
      const answer = answers.find(a => a.question_id === q.id);

      if (q.required === 1) {
        if (!answer || !answer.answer_text || answer.answer_text.trim() === '') {
          validationErrors.push({
            path: `answers.${q.id}`,
            message: `السؤال "${q.question_text}" إجابة مطلوبة`,
            code: 'QUESTION_REQUIRED',
          });
          continue;
        }
      }

      if (answer && answer.answer_text) {
        const text = answer.answer_text.trim();

        // Validate question type
        if (q.question_type === 'SINGLE_CHOICE' || q.question_type === 'YES_NO') {
          const options: string[] = JSON.parse(q.options || '[]');
          if (q.question_type === 'YES_NO') {
            if (text !== 'نعم' && text !== 'لا') {
              validationErrors.push({
                path: `answers.${q.id}`,
                message: `إجابة السؤال "${q.question_text}" يجب أن تكون "نعم" أو "لا"`,
                code: 'INVALID_ANSWER',
              });
            }
          } else if (options.length > 0 && !options.includes(text)) {
            validationErrors.push({
              path: `answers.${q.id}`,
              message: `إجابة السؤال "${q.question_text}" غير صحيحة`,
              code: 'INVALID_OPTION',
            });
          }
        } else if (q.question_type === 'MULTIPLE_CHOICE') {
          const selectedOptions = text.split(',').map(s => s.trim());
          const validOptions: string[] = JSON.parse(q.options || '[]');
          if (validOptions.length > 0) {
            for (const opt of selectedOptions) {
              if (!validOptions.includes(opt)) {
                validationErrors.push({
                  path: `answers.${q.id}`,
                  message: `الخيار "${opt}" غير صحيح في السؤال "${q.question_text}"`,
                  code: 'INVALID_OPTION',
                });
              }
            }
          }
        }
        // TEXT type: any text is valid
      }
    }

    // Reject unknown question IDs
    for (const answer of answers) {
      if (!questionMap.has(answer.question_id)) {
        validationErrors.push({
          path: `answers.${answer.question_id}`,
          message: 'معرف السؤال غير صحيح',
          code: 'UNKNOWN_QUESTION',
        });
      }
    }

    if (validationErrors.length > 0) {
      return Errors.validation(c, validationErrors);
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
      // If PENDING from a failed previous attempt, clean up the orphan so retry can proceed
      if (ex.status === 'PENDING') {
        await c.env.DB.prepare(`DELETE FROM audio_confirmations WHERE registration_id = ?`).bind(ex.id).run();
        await c.env.DB.prepare(`DELETE FROM registrations WHERE id = ? AND status = 'PENDING'`).bind(ex.id).run();
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

    // Get sequence number first (needed for registrationId)
    const seqResult = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(registration_sequence), 0) + 1 as next_seq FROM registrations WHERE mission_id = ?`
    ).bind(missionData.id).first();
    const nextSeq = (seqResult as any)?.next_seq || (confirmedCount + waitlistCount + 1);

    const registrationId = `${missionData.public_code}-REG-${String(nextSeq).padStart(6, '0')}`;
    const audioKey = generateAudioKey(missionData.public_code, registrationId);

    // 7. Save registration as PENDING first (INSERT before seat allocation)
    const ownershipToken = getOwnershipToken(c);
    const idempotencyKey = ownershipToken && volunteerId
      ? `${ownershipToken}:${missionData.id}:${volunteerId}` : null;

    await c.env.DB.prepare(
          `INSERT INTO registrations (
            id, mission_id, volunteer_id, status, seat_number, waitlist_position,
            registration_sequence, request_id, ownership_token, idempotency_key, created_at
          ) VALUES (?, ?, ?, 'PENDING', NULL, NULL, ?, ?, ?, ?, ${SQL_NOW_ISO})`
        ).bind(registrationId, missionData.id, volunteerId, nextSeq, request_id || null, ownershipToken, idempotencyKey).run();

    // 8. Atomic seat allocation using conditional UPDATE.
    // Row now exists as PENDING — UPDATE can find it.
    // Prevents double-booking the last seat via D1 atomic UPDATE + WHERE.
    const claimResult = await c.env.DB.prepare(
      `UPDATE registrations SET status = 'CONFIRMED', seat_number = COALESCE(
        (SELECT MAX(seat_number) FROM registrations WHERE mission_id = ? AND status = 'CONFIRMED'), 0
      ) + 1 WHERE id = ? AND status = 'PENDING'
       AND (SELECT COUNT(*) FROM registrations WHERE mission_id = ? AND status = 'CONFIRMED') < ?`
    ).bind(missionData.id, registrationId, missionData.id, capacity).run();

    if (claimResult.meta.changes > 0) {
      newStatus = 'CONFIRMED';
      seatNumber = (await c.env.DB.prepare(
        `SELECT seat_number FROM registrations WHERE id = ?`
      ).bind(registrationId).first() as any)?.seat_number;

      // AUTO-CLOSE: When confirmed fills capacity AND waitlist is also full (or no waitlist)
      try {
        const finalConfirmedCount = confirmedCount + 1;
        const waitingCap = waitingList || 0;
        const shouldClose = (finalConfirmedCount >= capacity) && (waitingCap === 0 || waitlistCount >= waitingCap);
        if (shouldClose && missionData.status === 'OPEN') {
          await c.env.DB.prepare(
            `UPDATE missions SET status = 'CLOSED', registration_close_at = datetime('now') WHERE id = ? AND status = 'OPEN'`
          ).bind(missionData.id).run();
          missionData.status = 'CLOSED';
          console.log(`[REGISTRATION] AUTO-CLOSED mission ${missionData.public_code}: confirmed=${finalConfirmedCount}/${capacity}, waitlist=${waitlistCount}/${waitingCap}`);
        }
      } catch (autoCloseErr) {
        console.error('[REGISTRATION] Failed auto-close on capacity full:', autoCloseErr);
      }
    } else {
      // Try waitlist claim
      const wlClaim = await c.env.DB.prepare(
        `UPDATE registrations SET status = 'WAITLIST', waitlist_position = COALESCE(
          (SELECT MAX(waitlist_position) FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'), 0
        ) + 1 WHERE id = ? AND status = 'PENDING'
         AND (SELECT COUNT(*) FROM registrations WHERE mission_id = ? AND status = 'WAITLIST') < ?`
      ).bind(missionData.id, registrationId, missionData.id, waitingList).run();

      if (wlClaim.meta.changes > 0) {
        newStatus = 'WAITLIST';
        waitlistPosition = (await c.env.DB.prepare(
          `SELECT waitlist_position FROM registrations WHERE id = ?`
        ).bind(registrationId).first() as any)?.waitlist_position;

        // BUG 5 FIX: Auto-close when both capacity and waiting list are full
        try {
          const updatedWaitlistCount = waitlistCount + 1;
          if (confirmedCount >= capacity && updatedWaitlistCount >= (waitingList || 0) && waitingList > 0) {
            await c.env.DB.prepare(
              `UPDATE missions SET status = 'CLOSED', registration_close_at = datetime('now') WHERE id = ? AND status = 'OPEN'`
            ).bind(missionData.id).run();
            missionData.status = 'CLOSED';
          }
        } catch (closeErr) {
          console.error('[REGISTRATION] Failed to auto-close mission after waitlist full:', closeErr);
        }
      } else {
        // No seats and no waiting list space — reject
        newStatus = 'REJECTED';
        try {
          await c.env.DB.prepare(
            `UPDATE registrations SET status = 'REJECTED' WHERE id = ? AND status = 'PENDING'`
          ).bind(registrationId).run();
        } catch (rejectErr) {
          console.error('[REGISTRATION] Failed to set REJECTED status:', rejectErr);
        }

        // Auto-close when fully full (independent of REJECTED update success)
        try {
          await c.env.DB.prepare(
            `UPDATE missions SET status = 'CLOSED', registration_close_at = datetime('now') WHERE id = ? AND status = 'OPEN'`
          ).bind(missionData.id).run();
          missionData.status = 'CLOSED';
        } catch (closeErr) {
          console.error('[REGISTRATION] Failed to auto-close mission:', closeErr);
        }
      }
    }

    // 9. Save R2 audio
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

    // 10. Update confirmed_at if needed
    if (newStatus === 'CONFIRMED') {
      await c.env.DB.prepare(
        `UPDATE registrations SET confirmed_at = datetime('now') WHERE id = ?`
      ).bind(registrationId).run();
    }

    // 10. Save audio confirmation record
    const audioId = generateUUID();
    const estDurationMs = durationMs || Math.max(2000, Math.floor(audioBuffer.byteLength / 8));
    const usedPhrase = phrase || missionData.confirmation_phrase || `أؤكد مشاركتي في مهمة ${missionData.public_code}`;
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ${SQL_NOW_ISO})`
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

    // 11b. Save question answers (persists across status changes)
    if (answers.length > 0 && newStatus !== 'REJECTED') {
      try {
        await saveRegistrationAnswers(c.env.DB, registrationId, answers);
      } catch (answerErr) {
        console.error('[REGISTRATION] Failed to save question answers:', answerErr);
        // Non-fatal: answers are optional for audit purposes
      }
    }

    // ─── 12. Outbox: queue Telegram notifications (durable, retryable) ───
        // Registration success MUST NOT fail because Telegram is slow/unavailable.
        // Instead of fire-and-forget fetch() calls (which are lost on failure),
        // write notification_events rows that the scheduled worker drains.
        // This replaces the old dead code that ran AFTER return and never executed.
        if (missionData.telegram_notifications === 1 && (newStatus === 'CONFIRMED' || newStatus === 'WAITLIST')) {
          try {
            const chatId = (c.env.ADMIN_CHAT_IDS || '').split(',')[0].trim();
            if (chatId) {
              const statusEmoji = newStatus === 'CONFIRMED' ? '✅' : '⏳';
              const text =
                `${statusEmoji} 🆕 تسجيل متطوع جديد\n\n` +
                `👤 الاسم: ${storedName}\n` +
                `🏷️ رقم العضوية: ${member_id}\n` +
                `📋 المهمة: ${missionData.public_code} (${missionData.title})\n` +
                `📊 الحالة: ${newStatus}${seatNumber ? `\n💺 رقم المقعد: ${seatNumber}` : ''}${waitlistPosition ? `\n⏳ رقم الانتظار: ${waitlistPosition}` : ''}`;

              const keyboard = [
                [
                  { text: '🎙️ استمع للتسجيل', callback_data: `v:audio:${registrationId}` },
                ],
                [
                  { text: '👋 رجوع', callback_data: 'cancel:action' },
                ],
              ];

              await createNotificationEvent(c.env.DB, {
                eventType: 'REGISTRATION',
                registrationId,
                missionId: missionData.id,
                adminChatId: chatId,
                payload: JSON.stringify({ text, keyboard, chat_id: chatId }),
              });

              // ─── INSTANT DELIVERY: Process the just-queued event immediately ───
              // Don't wait for the next cron tick (up to 60s). Send now; the outbox
              // retries on failure anyway.
              processPendingNotifications(c.env.DB, c.env.TELEGRAM_BOT_TOKEN || '', c.env.ADMIN_CHAT_IDS || '')
                .catch(err => console.error('[OUTBOX-INSTANT] Background send failed (cron will retry):', err));
            }
          } catch (outboxErr) {
            console.error('[OUTBOX] Failed to queue registration notification:', outboxErr);
          }
        }

        // ─── 13. Outbox: capacity notifications (core reached / waitlist full / mission complete) ───
        if (missionData.telegram_notifications === 1) {
          try {
            const chatId = (c.env.ADMIN_CHAT_IDS || '').split(',')[0].trim();
            if (chatId && newStatus !== 'REJECTED') {
              const confirmed = newStatus === 'CONFIRMED' ? confirmedCount + 1 : confirmedCount;
              const wl = newStatus === 'WAITLIST' ? waitlistCount + 1 : waitlistCount;

              let text = '';
              let emoji = '';
              if (newStatus === 'CONFIRMED' && confirmed >= capacity && wl > 0) {
                emoji = '⚠️';
                text = `${emoji} <b>العدد الأساسي كتمل!</b>\n\nالمهمة: ${missionData.title} (${missionData.public_code})\nالعدد الأساسي: ${capacity} ✅ مكتمل\nانتظار: ${wl} مقعد متاح\n\nتم فتح قائمة الانتظار. المتطوع الجديد هيبقى في الانتظار.`;
              } else if (newStatus === 'WAITLIST' && wl >= (waitingList || 0)) {
                emoji = '🔴';
                text = `${emoji} <b>العدد كتمل بالكامل!</b>\n\nالمهمة: ${missionData.title} (${missionData.public_code})\nالعدد الأساسي: ${capacity} ✅\nقائمة الانتظار: ${waitingList} ✅ مكتملة\n\n⚠️ لا يوجد مقاعد متاحة. التسجيل هيترفض.`;
              } else if (confirmed >= capacity && wl >= (waitingList || 0)) {
                emoji = '🏆';
                text = `${emoji} <b>اكتملت المهمة بالكامل!</b>\n\nالمهمة: ${missionData.title} (${missionData.public_code})\nالعدد الأساسي: ${capacity} ✅\nالانتظار: ${waitingList} ✅\nالاجمالي: ${capacity + (waitingList || 0)} متطوع\n\n📊 لعرض الاحصاءات: /missions`;
              }
              if (text) {
                await createNotificationEvent(c.env.DB, {
                  eventType: 'CAPACITY',
                  registrationId,
                  missionId: missionData.id,
                  adminChatId: chatId,
                  payload: JSON.stringify({ text, chat_id: chatId, keyboard: [] }),
                });
              }
            }
          } catch (outboxErr) {
            console.error('[OUTBOX] Failed to queue capacity notification:', outboxErr);
          }
        }

        // Phase 6: Increment mission version for live change detection
        await incrementMissionVersion(c.env.DB, missionData.id);

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
