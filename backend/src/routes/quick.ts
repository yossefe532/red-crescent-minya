import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { generateUUID } from '../utils/id';

const quickRoutes = new Hono<{ Bindings: Env }>();

// POST /api/quick-profile/save
// Save volunteer profile for quick future registration
quickRoutes.post('/quick-profile/save', async (c) => {
  try {
    const body = await c.req.json();
    const member_id = (body.member_id || '').trim();
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();

    // Validation
    if (!member_id || member_id.length < 1) {
      return Errors.validation(c, [{ path: 'member_id', message: 'رقم العضوية مطلوب' }]);
    }
    if (!name || name.length < 2) {
      return Errors.validation(c, [{ path: 'name', message: 'الاسم مطلوب ويجب أن يكون حرفين على الأقل' }]);
    }
    if (!phone || !/^01[0125][0-9]{8}$/.test(phone)) {
      return Errors.validation(c, [{ path: 'phone', message: 'رقم تليفون صالح مطلوب (11 رقم يبدأ بـ 01)' }]);
    }

    // Check or create volunteer
    let volunteer = await c.env.DB.prepare(
      `SELECT id FROM volunteers WHERE member_id = ?`
    ).bind(member_id).first();

    let volunteerId: string;
    if (!volunteer) {
      volunteerId = generateUUID();
      await c.env.DB.prepare(
        `INSERT INTO volunteers (id, member_id, name, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(volunteerId, member_id, name, phone).run();
    } else {
      volunteerId = (volunteer as any).id;
      // Update existing volunteer phone/name
      await c.env.DB.prepare(
        `UPDATE volunteers SET name = ?, phone = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(name, phone, volunteerId).run();
    }

    // Insert or update quick_profile
    const existingProfile = await c.env.DB.prepare(
      `SELECT id FROM quick_profiles WHERE volunteer_id = ?`
    ).bind(volunteerId).first();

    if (existingProfile) {
      await c.env.DB.prepare(
        `UPDATE quick_profiles 
         SET member_id = ?, name = ?, phone = ?, updated_at = datetime('now')
         WHERE volunteer_id = ?`
      ).bind(member_id, name, phone, volunteerId).run();
    } else {
      const profileId = generateUUID();
      await c.env.DB.prepare(
        `INSERT INTO quick_profiles (id, volunteer_id, member_id, name, phone, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
      ).bind(profileId, volunteerId, member_id, name, phone).run();
    }

    return success(c, {
      message: 'تم حفظ بياناتك بنجاح! في المرة القادمة أدخل رقم عضويتك فقط وستملأ بياناتك تلقائياً.',
      member_id,
      name,
      phone,
    });
  } catch (err: any) {
    console.error('Quick profile save error:', err);
    return Errors.internal(c);
  }
});

// GET /api/quick-profile/lookup/:memberId
// Get saved quick profile by member_id
quickRoutes.get('/quick-profile/lookup/:memberId', async (c) => {
  try {
    const memberId = c.req.param('memberId').trim();
    
    if (!memberId) {
      return Errors.validation(c, [{ path: 'member_id', message: 'رقم العضوية مطلوب' }]);
    }

    const profile = await c.env.DB.prepare(
      `SELECT qp.member_id, qp.name, qp.phone, v.id as volunteer_id
       FROM quick_profiles qp
       JOIN volunteers v ON v.id = qp.volunteer_id
       WHERE qp.member_id = ?`
    ).bind(memberId).first();

    if (!profile) {
      return success(c, { found: false });
    }

    const p = profile as any;
    
    // Update last_used_at
    await c.env.DB.prepare(
      `UPDATE quick_profiles SET last_used_at = datetime('now') WHERE member_id = ?`
    ).bind(memberId).run();

    return success(c, {
      found: true,
      member_id: p.member_id,
      name: p.name,
      phone: p.phone,
    });
  } catch (err: any) {
    console.error('Quick profile lookup error:', err);
    return Errors.internal(c);
  }
});

// POST /api/register-temporary
// Register without member_id (temporary registration)
quickRoutes.post('/register-temporary', async (c) => {
  try {
    const body = await c.req.json();
    const mission_public_code = (body.mission_public_code || '').trim();
    const name = (body.name || '').trim();
    const phone = (body.phone || '').trim();

    // Validation
    if (!mission_public_code) {
      return Errors.validation(c, [{ path: 'mission_public_code', message: 'كود المهمة مطلوب' }]);
    }
    if (!name || name.length < 2) {
      return Errors.validation(c, [{ path: 'name', message: 'الاسم مطلوب' }]);
    }
    if (!phone || !/^01[0125][0-9]{8}$/.test(phone)) {
      return Errors.validation(c, [{ path: 'phone', message: 'رقم تليفون صالح مطلوب' }]);
    }

    // Get mission
    const mission = await c.env.DB.prepare(
      `SELECT id, public_code, title, status, capacity, registration_open_at, registration_close_at
       FROM missions WHERE public_code = ?`
    ).bind(mission_public_code).first();

    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const missionData = mission as any;

    if (missionData.status !== 'OPEN') {
      return Errors.conflict(c, 'التسجيل في هذه المهمة غير متاح حالياً.');
    }

    const nowIso = new Date().toISOString();
    if (missionData.registration_close_at && nowIso >= missionData.registration_close_at) {
      return Errors.conflict(c, 'تم إغلاق باب التسجيل لهذه المهمة.');
    }

    // Check duplicate temporary registration (same phone + mission)
    const existing = await c.env.DB.prepare(
      `SELECT id, status, seat_number, waitlist_position FROM temporary_registrations
       WHERE mission_id = ? AND phone = ?`
    ).bind(missionData.id, phone).first();

    if (existing) {
      const ex = existing as any;
      return c.json({
        success: false,
        error: {
          code: 'ALREADY_REGISTERED',
          message: ex.status === 'CONFIRMED'
            ? `أنت مسجل بالفعل (مؤقتاً) في هذه المهمة برقم المقعد ${ex.seat_number}.`
            : `أنت مسجل بالفعل (مؤقتاً) في قائمة الانتظار برقم ${ex.waitlist_position}.`,
        }
      }, 409);
    }

    // Get current counts
    const counts = await c.env.DB.prepare(
      `SELECT 
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
         COUNT(*) as total
       FROM registrations WHERE mission_id = ?`
    ).bind(missionData.id).first();

    const countsData = counts as any;
    const confirmedCount = countsData?.confirmed || 0;
    const totalSeq = (countsData?.total || 0) + 1;

    const isFull = confirmedCount >= missionData.capacity;
    const status = isFull ? 'WAITLIST' : 'CONFIRMED';
    const seatNumber = isFull ? null : confirmedCount + 1;

    // Calculate waitlist position if needed
    let waitlistPosition = null;
    if (isFull) {
      const waitlistCount = await c.env.DB.prepare(
        `SELECT COUNT(*) as wcount FROM temporary_registrations 
         WHERE mission_id = ? AND status = 'WAITLIST'`
      ).bind(missionData.id).first();
      waitlistPosition = ((waitlistCount as any)?.wcount || 0) + 1;
    }

    const tempId = generateUUID();
    await c.env.DB.prepare(
      `INSERT INTO temporary_registrations 
       (id, mission_id, name, phone, status, seat_number, waitlist_position, registration_sequence, created_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(tempId, missionData.id, name, phone, status, seatNumber, waitlistPosition, totalSeq).run();

    return success(c, {
      registration_id: tempId,
      status,
      seat_number: seatNumber,
      waitlist_position: waitlistPosition,
      name,
      phone,
      mission_code: missionData.public_code,
      mission_title: missionData.title,
      message: status === 'CONFIRMED'
        ? `تم تسجيلك مؤقتاً بنجاح! رقم المقعد: ${seatNumber}. برجاء تحديث رقم عضويتك لاحقاً.`
        : `تم إضافتك لقائمة الانتظار برقم ${waitlistPosition}.`,
    });
  } catch (err: any) {
    console.error('Temporary registration error:', err);
    return Errors.internal(c);
  }
});

export { quickRoutes };
