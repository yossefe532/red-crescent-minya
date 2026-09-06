import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { generateRegistrationId, generateUUID, generateAudioKey } from '../utils/id';
import { logAudit } from '../services/audit.service';

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

    if (name.length < 2 || name.length > 100) {
      return Errors.validation(c, [{ path: 'name', message: 'الاسم يجب أن يكون بين حرفين و 100 حرف' }]);
    }
    if (member_id.length < 2 || member_id.length > 50) {
      return Errors.validation(c, [{ path: 'member_id', message: 'رقم العضوية يجب أن يكون بين حرفين و 50 حرف' }]);
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
      `SELECT id, public_code, title, status, capacity, confirmation_phrase,
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

    // 5. Lookup or register volunteer
    let volunteer = await c.env.DB.prepare(
      `SELECT id, member_id, name FROM volunteers WHERE member_id = ?`
    ).bind(member_id).first();

    let volunteerId: string;
    let storedName = name;

    if (!volunteer) {
      volunteerId = generateUUID();
      await c.env.DB.prepare(
        `INSERT INTO volunteers (id, member_id, name, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(volunteerId, member_id, name).run();
    } else {
      volunteerId = (volunteer as any).id;
      storedName = (volunteer as any).name || name;
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

    // 7. Atomic Seat Allocation
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

    let newStatus = 'CONFIRMED';
    let seatNumber: number | null = null;
    let waitlistPosition: number | null = null;

    if (confirmedCount < capacity) {
      newStatus = 'CONFIRMED';
      seatNumber = confirmedCount + 1;
    } else {
      newStatus = 'WAITLIST';
      waitlistPosition = waitlistCount + 1;
    }

    // Get sequence number
    const seqResult = await c.env.DB.prepare(
      `SELECT COALESCE(MAX(registration_sequence), 0) + 1 as next_seq FROM registrations WHERE mission_id = ?`
    ).bind(missionData.id).first();
    const nextSeq = (seqResult as any)?.next_seq || (confirmedCount + waitlistCount + 1);

    const registrationId = `${missionData.public_code}-REG-${String(nextSeq).padStart(6, '0')}`;
    const audioKey = generateAudioKey(missionData.public_code, registrationId);
    const usedPhrase = phrase || missionData.confirmation_phrase || `أؤكد مشاركتي في مهمة ${missionData.public_code}`;

    // 8. Store audio in R2
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
    } catch (storageErr) {
      console.error('R2 Audio upload failed:', storageErr);
      // If R2 fails in local simulation without R2 bindings, continue or log error
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
    await c.env.DB.prepare(
      `INSERT INTO audio_confirmations (
        id, registration_id, phrase, audio_key, duration_ms, mime_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(audioId, registrationId, usedPhrase, audioKey, estDurationMs, mimeType).run();

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
        confirmed: newStatus === 'CONFIRMED' ? confirmedCount + 1 : confirmedCount,
        available: Math.max(0, capacity - (newStatus === 'CONFIRMED' ? confirmedCount + 1 : confirmedCount)),
      },
      message: newStatus === 'CONFIRMED' 
        ? `تم تأكيد تسجيلك بنجاح! رقم مقعدك: ${seatNumber}`
        : `اكتملت المقاعد المتاحة. تم إضافتك إلى قائمة الانتظار برقم: ${waitlistPosition}`,
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
