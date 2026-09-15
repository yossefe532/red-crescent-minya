import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { success, Errors } from '../utils/response';
import { APP_TIMEZONE } from '../config/timezone';
import { adminAuth, getAdminId, createSession } from '../middleware/auth';
import { authenticateAdmin } from '../services/admin.service';
import {
  createMission,
  getMissionById,
  listMissions,
  updateMission,
  deleteMission,
  getMissionAvailability,
} from '../services/mission.service';
import { logAudit } from '../services/audit.service';
import { createMissionSchema, updateMissionSchema } from '../validation/admin.schema';
import { incrementMissionVersion } from '../utils/version';
import {
  getAllMissionRequirements,
  createRequirement,
  updateRequirement,
  deleteRequirement,
  getAllMissionQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getRegistrationAnswers,
  getQuestionWithAnswers,
} from '../services/mission.requirements.service';

const adminRoutes = new Hono<AppEnv>();

// POST /api/admin/login
adminRoutes.post('/login', async (c) => {
  try {
    const { username, password } = await c.req.json();
    if (!username || !password) {
      return Errors.validation(c, [
        { path: 'username', message: 'اسم المستخدم مطلوب' },
        { path: 'password', message: 'كلمة المرور مطلوبة' },
      ]);
    }

    const result = await authenticateAdmin(c.env.DB, username, password);
    if (!result) {
      return c.json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'بيانات الدخول غير صحيحة' }
      }, 401);
    }

    // Create session in D1 and get token
    const token = await createSession(result.admin_id, result.username, c.env);

    return success(c, { ...result, token, message: 'تم تسجيل الدخول بنجاح' });
  } catch (err: any) {
    console.error('Login error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/logout
adminRoutes.post('/logout', adminAuth, async (c) => {
  try {
    const adminId = getAdminId(c);
    // Try X-Auth-Token first, then Authorization header
    const token = c.req.header('X-Auth-Token') || c.req.header('Authorization')?.replace('Bearer ', '');
    if (token) {
      await c.env.DB.prepare('DELETE FROM admin_sessions WHERE token = ?').bind(token).run();
    }
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'ADMIN_LOGOUT',
      entityType: 'admin',
      entityId: adminId,
    });
    return success(c, { message: 'تم تسجيل الخروج بنجاح' });
  } catch (err: any) {
    console.error('Logout error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/missions - Create new mission
adminRoutes.post('/missions', adminAuth, async (c) => {
  try {
    const body = await c.req.json();
    const parsed = createMissionSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.validation(c, parsed.error.issues);
    }

    const adminId = getAdminId(c);
    const mission = await createMission(c.env.DB, parsed.data as Record<string, unknown>);

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'MISSION_CREATED',
      entityType: 'mission',
      entityId: mission.id,
      metadata: { title: mission.title, capacity: mission.capacity },
    });

    return success(c, mission);
  } catch (err: any) {
    console.error('Create mission error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions - List all missions
adminRoutes.get('/missions', adminAuth, async (c) => {
  try {
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const status = c.req.query('status') || undefined;

    const offset = (page - 1) * limit;
    const result = await listMissions(c.env.DB, { limit, offset, status });

    return success(c, {
      missions: result.missions,
      total: result.total,
      page,
      limit,
    });
  } catch (err: any) {
    console.error('List missions error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions/:id - Mission details + registration counts
adminRoutes.get('/missions/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, id);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }
    const availability = await getMissionAvailability(c.env.DB, id);
    return success(c, { ...mission, ...availability });
  } catch (err: any) {
    console.error('Get mission error:', err);
    return Errors.internal(c);
  }
});

// PATCH /api/admin/missions/:id - Update mission (including capacity, status, registration window)
adminRoutes.patch('/missions/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const body = await c.req.json();
    const parsed = updateMissionSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.validation(c, parsed.error.issues);
    }

    const adminId = getAdminId(c);
    const mission = await updateMission(c.env.DB, id, parsed.data as Record<string, unknown>);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'MISSION_UPDATED',
      entityType: 'mission',
      entityId: id,
      metadata: parsed.data,
    });

    return success(c, mission);
  } catch (err: any) {
    console.error('Update mission error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/missions/:id/toggle-registration - Toggle registration open/close
adminRoutes.post('/missions/:id/toggle-registration', adminAuth, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const body = await c.req.json();
    const { open } = body;

    if (typeof open !== 'boolean') {
      return Errors.validation(c, [{ path: 'open', message: 'يجب تحديد open كـ true أو false' }]);
    }

    const mission = await getMissionById(c.env.DB, id);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    // Update registration window based on open flag
    const nowIso = new Date().toISOString();
    const updates: Record<string, unknown> = {};

    if (open) {
      // Open registration: set open_at to now, clear close_at (NULL = open until manually closed)
      updates.registration_open_at = nowIso;
      updates.registration_close_at = null;
      updates.status = 'OPEN';
    } else {
      // Close registration: set close_at to now AND status to CLOSED
      updates.registration_close_at = nowIso;
      updates.status = 'CLOSED';
    }

    const updated = await updateMission(c.env.DB, id, updates);

    const adminId = getAdminId(c);
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: open ? 'REGISTRATION_OPENED' : 'REGISTRATION_CLOSED',
      entityType: 'mission',
      entityId: id,
    });

    return success(c, {
      mission: updated,
      message: open ? 'تم فتح باب التسجيل للمهمة' : 'تم إغلاق باب التسجيل للمهمة',
    });
  } catch (err: any) {
    console.error('Toggle registration error:', err);
    return Errors.internal(c);
  }
});

// PATCH /api/admin/missions/:id/details - Edit mission details (title, description, location, capacity, dates)
adminRoutes.patch('/missions/:id/details', adminAuth, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const body = await c.req.json();

    const mission = await getMissionById(c.env.DB, id);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    // Validate and prepare updates
    const updates: Record<string, unknown> = {};
    
    if (body.title !== undefined) {
      if (!body.title || body.title.trim().length < 3) {
        return Errors.validation(c, [{ path: 'title', message: 'عنوان المهمة يجب أن يكون 3 أحرف على الأقل' }]);
      }
      updates.title = body.title.trim();
    }

    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }

    if (body.location !== undefined) {
      updates.location = body.location?.trim() || null;
    }

    if (body.capacity !== undefined) {
      const cap = Number(body.capacity);
      if (isNaN(cap) || cap < 1 || cap > 1000) {
        return Errors.validation(c, [{ path: 'capacity', message: 'السعة يجب أن تكون بين 1 و 1000' }]);
      }
      updates.capacity = cap;
    }

    if (body.start_at !== undefined) {
      updates.start_at = new Date(body.start_at).toISOString();
    }

    if (body.end_at !== undefined) {
      updates.end_at = new Date(body.end_at).toISOString();
    }

    // Validate dates if both provided
    if (updates.start_at && updates.end_at) {
      if (new Date(updates.start_at as string) >= new Date(updates.end_at as string)) {
        return Errors.validation(c, [{ path: 'dates', message: 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية' }]);
      }
    }

    const updated = await updateMission(c.env.DB, id, updates);

    const adminId = getAdminId(c);
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'MISSION_DETAILS_UPDATED',
      entityType: 'mission',
      entityId: id,
    });

    return success(c, { 
      mission: updated,
      message: 'تم تحديث تفاصيل المهمة بنجاح'
    });
  } catch (err: any) {
    console.error('Update mission details error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/missions/:id/close - Close mission permanently
adminRoutes.post('/missions/:id/close', adminAuth, async (c) => {
  try {
    const id = c.req.param('id') as string;
    
    const mission = await getMissionById(c.env.DB, id);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const nowIso = new Date().toISOString();
    const updated = await updateMission(c.env.DB, id, {
      status: 'CLOSED',
      registration_close_at: nowIso,
    });

    const adminId = getAdminId(c);
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'MISSION_CLOSED',
      entityType: 'mission',
      entityId: id,
    });

    return success(c, {
      mission: updated,
      message: 'تم إغلاق المهمة نهائياً',
    });
  } catch (err: any) {
    console.error('Close mission error:', err);
    return Errors.internal(c);
  }
});

// DELETE /api/admin/missions/:id - Delete mission
adminRoutes.delete('/missions/:id', adminAuth, async (c) => {
  try {
    const id = c.req.param('id') as string;
    const deleted = await deleteMission(c.env.DB, id);
    if (!deleted) {
      return Errors.notFound(c, 'Mission');
    }

    await logAudit(c.env.DB, {
      actorId: getAdminId(c),
      actorType: 'admin',
      action: 'MISSION_DELETED',
      entityType: 'mission',
      entityId: id,
    });

    return success(c, { message: 'Mission deleted.' });
  } catch (err: any) {
    console.error('Delete mission error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions/:id/registrations - List all registrations for a mission
adminRoutes.get('/missions/:id/registrations', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;

    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const registrations = await c.env.DB.prepare(
      `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
              r.created_at, r.confirmed_at, r.cancelled_at,
              v.member_id, v.name as volunteer_name, v.phone,
              ac.id as audio_id, ac.phrase, ac.duration_ms, ac.mime_type,
              CASE WHEN ac.audio_data IS NOT NULL AND length(ac.audio_data) > 100 
                   THEN 1 ELSE 0 END as has_audio_data
       FROM registrations r
       JOIN volunteers v ON v.id = r.volunteer_id
       LEFT JOIN audio_confirmations ac ON ac.registration_id = r.id
       WHERE r.mission_id = ?
       ORDER BY r.registration_sequence ASC`
    )
      .bind(missionId)
      .all();

    // Also get temporary registrations
    const tempRegs = await c.env.DB.prepare(
      `SELECT id, status, seat_number, waitlist_position, registration_sequence,
              created_at, confirmed_at, cancelled_at, name as volunteer_name, phone,
              'TEMP' as member_id, null as audio_id, null as phrase, null as duration_ms
       FROM temporary_registrations
       WHERE mission_id = ?
       ORDER BY registration_sequence ASC`
    )
      .bind(missionId)
      .all();

    const allRegs = [
      ...(registrations.results || []),
      ...(tempRegs.results || []),
    ].sort((a: any, b: any) => a.registration_sequence - b.registration_sequence);

    const confirmed = allRegs.filter((r: any) => r.status === 'CONFIRMED').length;
    const waitlist = allRegs.filter((r: any) => r.status === 'WAITLIST').length;
    const cancelled = allRegs.filter((r: any) => r.status === 'CANCELLED').length;

    return success(c, {
      mission: {
        id: mission.id,
        title: mission.title,
        public_code: mission.public_code,
        capacity: mission.capacity,
      },
      registrations: allRegs,
      total: allRegs.length,
      confirmed,
      waitlist,
      cancelled,
    });
  } catch (err: any) {
    console.error('Get registrations error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/registrations/:regId/cancel - Cancel a registration (frontend calls this)
adminRoutes.post('/registrations/:regId/cancel', adminAuth, async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const adminId = getAdminId(c);

    const { cancelRegistration } = await import('../services/cancel.service');
    const result = await cancelRegistration(c.env.DB, regId, 'admin');

    // Audit log
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REGISTRATION_CANCELLED',
      entityType: 'registration',
      entityId: regId,
      metadata: {
        mission_id: (result as any).mission_id,
        seat_number: result.seat_number,
      },
    });

    return success(c, {
      cancelled_registration_id: regId,
      promoted_volunteer: result.promoted_volunteer,
      message: result.promoted_volunteer
        ? `تم إلغاء التسجيل وترقية ${result.promoted_volunteer.name} للقائمة المؤكدة`
        : 'تم إلغاء التسجيل بنجاح',
    });
  } catch (err: any) {
    if (err.message === 'ALREADY_CANCELLED') {
      return Errors.conflict(c, 'التسجيل ملغي بالفعل');
    }
    if (err.message === 'REGISTRATION_NOT_FOUND') {
      return Errors.notFound(c, 'Registration');
    }
    console.error('Cancel registration error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/registrations/:regId/status - Move volunteer between WAITLIST and CONFIRMED
adminRoutes.post('/registrations/:regId/status', adminAuth, async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const body = await c.req.json();
    const targetStatus = body?.status;

    if (targetStatus !== 'CONFIRMED' && targetStatus !== 'WAITLIST') {
      return Errors.validation(c, [
        { path: 'status', message: 'status يجب أن يكون CONFIRMED أو WAITLIST' },
      ]);
    }

    // Fetch registration JOIN volunteer + mission (same as Telegram handleVolunteerMove)
    const regResult = await c.env.DB.prepare(
      `SELECT r.id, r.status, r.seat_number, r.waitlist_position, v.name, m.title, m.public_code, m.id as mission_id
       FROM registrations r
       JOIN volunteers v ON v.id = r.volunteer_id
       JOIN missions m ON r.mission_id = m.id
       WHERE r.id = ?`
    ).bind(regId).first();
    const reg = regResult as any;

    if (!reg) {
      return Errors.notFound(c, 'Registration');
    }

    if (reg.status === 'CANCELLED') {
      return Errors.conflict(c, 'لا يمكن تغيير حالة تسجيل ملغي');
    }

    if (reg.status === targetStatus) {
      return Errors.conflict(c, `المتطوع بالفعل ${targetStatus === 'CONFIRMED' ? 'مؤكد' : 'في قائمة الانتظار'}`);
    }

    const availability = await getMissionAvailability(c.env.DB, reg.mission_id);

    // ── Moving to CONFIRMED ──
    if (targetStatus === 'CONFIRMED') {
      if (availability.available <= 0) {
        return Errors.conflict(c, 'لا يمكن تأكيد المتطوع: لا يوجد مقعد شاغر');
      }

      const newSeat = availability.confirmed + 1;

      await c.env.DB.prepare(
        `UPDATE registrations
         SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now')
         WHERE id = ?`
      ).bind(newSeat, regId).run();

      // Decrement waitlist positions of those after this volunteer
      if (reg.waitlist_position) {
        await c.env.DB.prepare(
          `UPDATE registrations SET waitlist_position = waitlist_position - 1
           WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`
        ).bind(reg.mission_id, reg.waitlist_position).run();
      }

      const adminId = getAdminId(c);
      await logAudit(c.env.DB, {
        actorId: adminId,
        actorType: 'admin',
        action: 'VOLUNTEER_CONFIRMED',
        entityType: 'registration',
        entityId: regId,
        metadata: { missionId: reg.mission_id, seatNumber: newSeat },
      });

      return success(c, {
        registration_id: regId,
        status: 'CONFIRMED',
        seat_number: newSeat,
        message: `تم تأكيد ${reg.name} في المقعد ${newSeat}`,
      });
    }

    // ── Moving to WAITLIST ──
    if (targetStatus === 'WAITLIST') {
      if (availability.waitlist_available <= 0) {
        return Errors.conflict(c, 'لا يمكن نقل المتطوع للانتظار: قائمة الانتظار ممتلئة');
      }

      const newWaitlistPos = availability.waitlist + 1;

      await c.env.DB.prepare(
        `UPDATE registrations
         SET status = 'WAITLIST', waitlist_position = ?, seat_number = NULL
         WHERE id = ?`
      ).bind(newWaitlistPos, regId).run();

      // Free the seat — promote first waitlisted if any
      if (reg.seat_number) {
        const next = await c.env.DB.prepare(
          `SELECT r.id FROM registrations r
           WHERE r.mission_id = ? AND r.status = 'WAITLIST' AND r.id != ?
           ORDER BY r.waitlist_position ASC LIMIT 1`
        ).bind(reg.mission_id, regId).first() as any;

        if (next) {
          await c.env.DB.prepare(
            `UPDATE registrations SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now')
             WHERE id = ?`
          ).bind(reg.seat_number, next.id).run();

          await c.env.DB.prepare(
            `UPDATE registrations SET waitlist_position = waitlist_position - 1
             WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`
          ).bind(reg.mission_id, reg.waitlist_position || 0).run();
        }
      }

      const adminId = getAdminId(c);
      await logAudit(c.env.DB, {
        actorId: adminId,
        actorType: 'admin',
        action: 'VOLUNTEER_WAITLISTED',
        entityType: 'registration',
        entityId: regId,
        metadata: { missionId: reg.mission_id, waitlistPosition: newWaitlistPos },
      });

      // Phase 6: Increment mission version for live change detection
      await incrementMissionVersion(c.env.DB, reg.mission_id);

      return success(c, {
        registration_id: regId,
        status: 'WAITLIST',
        waitlist_position: newWaitlistPos,
        message: `تم تحويل ${reg.name} إلى قائمة الانتظار (رقم ${newWaitlistPos})`,
      });
    }
  } catch (err: any) {
    console.error('Change registration status error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/missions/:id/cancel/:regId - Cancel a specific registration (with mission in URL)
adminRoutes.post('/missions/:id/cancel/:regId', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const regId = c.req.param('regId') as string;

    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) return Errors.notFound(c, 'Mission');

    const { cancelRegistration } = await import('../services/cancel.service');
    const result = await cancelRegistration(c.env.DB, regId, 'admin');

    const adminId = getAdminId(c);
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REGISTRATION_CANCELLED',
      entityType: 'registration',
      entityId: regId,
      metadata: { missionId, seat_number: result.seat_number },
    });

    return success(c, {
      cancelled_registration_id: regId,
      promoted_volunteer: result.promoted_volunteer,
      message: 'تم إلغاء التسجيل بنجاح',
    });
  } catch (err: any) {
    if (err.message === 'ALREADY_CANCELLED') {
      return Errors.conflict(c, 'التسجيل ملغي بالفعل');
    }
    if (err.message === 'REGISTRATION_NOT_FOUND') {
      return Errors.notFound(c, 'Registration');
    }
    console.error('Cancel registration error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions/:id/export - Export registrations to CSV
adminRoutes.get('/missions/:id/export', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;

    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const registrations = await c.env.DB.prepare(
      `SELECT r.id, r.status, r.seat_number, r.waitlist_position, r.registration_sequence,
              r.created_at, v.member_id, v.name as volunteer_name, v.phone
       FROM registrations r
       JOIN volunteers v ON v.id = r.volunteer_id
       WHERE r.mission_id = ?
       ORDER BY r.registration_sequence ASC`
    )
      .bind(missionId)
      .all();

    const tempRegs = await c.env.DB.prepare(
      `SELECT id, status, seat_number, waitlist_position, registration_sequence,
              created_at, 'مؤقت' as member_id, name as volunteer_name, phone
       FROM temporary_registrations
       WHERE mission_id = ?
       ORDER BY registration_sequence ASC`
    )
      .bind(missionId)
      .all();

    const allRegs = [
      ...(registrations.results || []),
      ...(tempRegs.results || []),
    ].sort((a: any, b: any) => a.registration_sequence - b.registration_sequence);

    // Build CSV with UTF-8 BOM for Excel Arabic compatibility
    const BOM = '\uFEFF';
    const headers = 'الترتيب,رقم العضوية,الاسم,رقم التليفون,الحالة,رقم المقعد,الموقع في الانتظار,تاريخ التسجيل\n';
    const rows = allRegs
      .map((r: any, idx: number) => {
        const statusAr =
          r.status === 'CONFIRMED'
            ? 'مؤكد'
            : r.status === 'WAITLIST'
            ? 'انتظار'
            : r.status === 'CANCELLED'
            ? 'ملغي'
            : 'قيد المراجعة';
        const seatDisplay = r.seat_number || '-';
        const waitlistDisplay = r.waitlist_position || '-';
        const date = new Date(r.created_at.endsWith('Z') || r.created_at.includes('+') ? r.created_at : r.created_at + 'Z').toLocaleString('ar-EG', { timeZone: APP_TIMEZONE });
        return `${idx + 1},"${r.member_id}","${r.volunteer_name}","${r.phone}","${statusAr}","${seatDisplay}","${waitlistDisplay}","${date}"`;
      })
      .join('\n');

    const csv = BOM + headers + rows;

    return c.text(csv, 200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="mission_${mission.public_code}_registrations.csv"`,
    });
  } catch (err: any) {
    console.error('Export registrations error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/registrations/:regId/audio - Get audio recording for a registration
adminRoutes.get('/registrations/:regId/audio', adminAuth, async (c) => {
  try {
    const regId = c.req.param('regId') as string;

    const audioRec = await c.env.DB.prepare(
      `SELECT audio_key, mime_type, audio_data FROM audio_confirmations WHERE registration_id = ?`
    ).bind(regId).first();

    if (!audioRec) {
      return Errors.notFound(c, 'Audio recording');
    }

    let body: ReadableStream | ArrayBuffer | null = null;

    // Try R2 first
    try {
      const r2Object = await c.env.AUDIO_BUCKET.get((audioRec as any).audio_key);
      if (r2Object) {
        body = r2Object.body;
      }
    } catch (_r2Err) {
      // R2 unavailable or binding missing — fall back to D1 blob
    }

    // Fall back to D1 blob (stored as base64 text — D1 can't hold raw BLOBs)
    if (body === null && (audioRec as any).audio_data) {
      const b64 = (audioRec as any).audio_data as string;
      try {
        const binaryStr = atob(b64.trim());
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        body = bytes.buffer as ArrayBuffer;
      } catch (_b64Err) {
        console.error('Audio base64 decode failed:', _b64Err);
      }
    }

    if (body === null) {
      return Errors.notFound(c, 'Audio file');
    }

    const headers = new Headers();
    headers.set('Content-Type', (audioRec as any).mime_type || 'audio/webm');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(body as BodyInit, { headers });
  } catch (err: any) {
    console.error('Get audio error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/registrations/:regId/restore — Restore a cancelled registration
adminRoutes.post('/registrations/:regId/restore', adminAuth, async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const adminId = getAdminId(c);

    const reg = await c.env.DB.prepare(
      `SELECT id, status FROM registrations WHERE id = ?`
    ).bind(regId).first();

    if (!reg) return Errors.notFound(c, 'Registration');
    if ((reg as any).status !== 'CANCELLED') {
      return Errors.conflict(c, 'لا يمكن استرجاع تسجيل غير ملغي');
    }

    const { restoreRegistration } = await import('../services/restore.service');
    const result = await restoreRegistration(c.env.DB, regId, adminId);

    // Queue Telegram notification
    try {
      const chatId = (c.env.ADMIN_CHAT_IDS || '').split(',')[0].trim();
      if (chatId) {
        const regFull = await c.env.DB.prepare(
          `SELECT r.id, r.mission_id, v.name, m.title, m.public_code
           FROM registrations r
           JOIN volunteers v ON v.id = r.volunteer_id
           JOIN missions m ON r.mission_id = m.id
           WHERE r.id = ?`
        ).bind(regId).first();

        if (regFull) {
          const rf = regFull as any;
          let text = `✅ <b>استرجاع تسجيل</b>\n\n`;
          text += `👤 الاسم: ${rf.name}\n`;
          text += `📋 المهمة: ${rf.public_code} (${rf.title})\n`;
          text += `📊 الحالة الجديدة: ${result.restored_status}`;

          if (result.revoked_promotion) {
            text += `\n\n⚠️ تم إلغاء ترقية ${result.revoked_promotion.name} (${result.revoked_promotion.registration_id})`;
          }

          const { createNotificationEvent } = await import('../services/notification_outbox');
          await createNotificationEvent(c.env.DB, {
            eventType: 'REGISTRATION_RESTORED',
            registrationId: regId,
            missionId: rf.mission_id,
            adminChatId: chatId,
            payload: JSON.stringify({ text, chat_id: chatId }),
          });
        }
      }
    } catch (outboxErr) {
      console.error('[OUTBOX] Failed to queue restore notification:', outboxErr);
    }

    return success(c, {
      restored_registration_id: regId,
      restored_status: result.restored_status,
      revoked_promotion: result.revoked_promotion,
      message: result.revoked_promotion
        ? `تم استرجاع التسجيل (${result.restored_status}) وإلغاء ترقية ${result.revoked_promotion.name}`
        : `تم استرجاع التسجيل بنجاح (${result.restored_status})`,
    });
  } catch (err: any) {
    if (err.message === 'NOT_CANCELLED') {
      return Errors.conflict(c, 'لا يمكن استرجاع تسجيل غير ملغي');
    }
    console.error('Restore registration error:', err);
    return Errors.internal(c);
  }
});

// ─── Mission Requirements CRUD (Admin) ────────────────

// GET /api/admin/missions/:id/requirements - List all requirements for a mission
adminRoutes.get('/missions/:id/requirements', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) return Errors.notFound(c, 'Mission');

    const requirements = await getAllMissionRequirements(c.env.DB, missionId);
    return success(c, { requirements });
  } catch (err: any) {
    console.error('List requirements error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/missions/:id/requirements - Create a requirement
adminRoutes.post('/missions/:id/requirements', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) return Errors.notFound(c, 'Mission');

    const body = await c.req.json();
    const { type, text, requires_acceptance, auto_verify, sort_order } = body;

    if (!type || !text) {
      return Errors.validation(c, [
        { path: 'type', message: 'نوع المتطلب مطلوب' },
        { path: 'text', message: 'نص المتطلب مطلوب' },
      ]);
    }

    const adminId = getAdminId(c);
    const requirement = await createRequirement(
      c.env.DB, missionId, type, text,
      requires_acceptance ?? 0, auto_verify ?? 0, sort_order ?? 0
    );

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REQUIREMENT_CREATED',
      entityType: 'requirement',
      entityId: requirement.id,
      metadata: { mission_id: missionId, type, text },
    });

    return success(c, requirement);
  } catch (err: any) {
    console.error('Create requirement error:', err);
    return Errors.internal(c);
  }
});

// PATCH /api/admin/missions/:missionId/requirements/:reqId - Update a requirement
adminRoutes.patch('/missions/:missionId/requirements/:reqId', adminAuth, async (c) => {
  try {
    const reqId = c.req.param('reqId') as string;
    const body = await c.req.json();
    const adminId = getAdminId(c);

    const requirement = await updateRequirement(c.env.DB, reqId, body);
    if (!requirement) return Errors.notFound(c, 'Requirement');

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REQUIREMENT_UPDATED',
      entityType: 'requirement',
      entityId: reqId,
      metadata: body,
    });

    return success(c, requirement);
  } catch (err: any) {
    console.error('Update requirement error:', err);
    return Errors.internal(c);
  }
});

// DELETE /api/admin/missions/:missionId/requirements/:reqId - Soft-delete a requirement
adminRoutes.delete('/missions/:missionId/requirements/:reqId', adminAuth, async (c) => {
  try {
    const reqId = c.req.param('reqId') as string;
    const adminId = getAdminId(c);

    await deleteRequirement(c.env.DB, reqId);

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REQUIREMENT_DELETED',
      entityType: 'requirement',
      entityId: reqId,
    });

    return success(c, { message: 'تم حذف المتطلب بنجاح' });
  } catch (err: any) {
    console.error('Delete requirement error:', err);
    return Errors.internal(c);
  }
});

// ─── Mission Questions CRUD (Admin) ──────────────────

// GET /api/admin/missions/:id/questions - List all questions for a mission
adminRoutes.get('/missions/:id/questions', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) return Errors.notFound(c, 'Mission');

    const questions = await getAllMissionQuestions(c.env.DB, missionId);
    return success(c, { questions });
  } catch (err: any) {
    console.error('List questions error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/missions/:id/questions - Create a question
adminRoutes.post('/missions/:id/questions', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) return Errors.notFound(c, 'Mission');

    const body = await c.req.json();
    const { question_text, question_type, required, options, sort_order } = body;

    if (!question_text || !question_type) {
      return Errors.validation(c, [
        { path: 'question_text', message: 'نص السؤال مطلوب' },
        { path: 'question_type', message: 'نوع السؤال مطلوب' },
      ]);
    }

    const adminId = getAdminId(c);
    const question = await createQuestion(
      c.env.DB, missionId, question_text, question_type,
      required ?? 1, options ?? '[]', sort_order ?? 0
    );

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'QUESTION_CREATED',
      entityType: 'question',
      entityId: question.id,
      metadata: { mission_id: missionId, question_text, question_type },
    });

    return success(c, question);
  } catch (err: any) {
    console.error('Create question error:', err);
    return Errors.internal(c);
  }
});

// PATCH /api/admin/missions/:missionId/questions/:questionId - Update a question
adminRoutes.patch('/missions/:missionId/questions/:questionId', adminAuth, async (c) => {
  try {
    const questionId = c.req.param('questionId') as string;
    const body = await c.req.json();
    const adminId = getAdminId(c);

    const question = await updateQuestion(c.env.DB, questionId, body);
    if (!question) return Errors.notFound(c, 'Question');

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'QUESTION_UPDATED',
      entityType: 'question',
      entityId: questionId,
      metadata: body,
    });

    return success(c, question);
  } catch (err: any) {
    console.error('Update question error:', err);
    return Errors.internal(c);
  }
});

// DELETE /api/admin/missions/:missionId/questions/:questionId - Soft-delete a question
adminRoutes.delete('/missions/:missionId/questions/:questionId', adminAuth, async (c) => {
  try {
    const questionId = c.req.param('questionId') as string;
    const adminId = getAdminId(c);

    await deleteQuestion(c.env.DB, questionId);

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'QUESTION_DELETED',
      entityType: 'question',
      entityId: questionId,
    });

    return success(c, { message: 'تم حذف السؤال بنجاح' });
  } catch (err: any) {
    console.error('Delete question error:', err);
    return Errors.internal(c);
  }
});

// ─── Registration Answers (Admin) ────────────────────

// GET /api/admin/registrations/:regId/answers - Get answers for a registration
adminRoutes.get('/registrations/:regId/answers', adminAuth, async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const answers = await getRegistrationAnswers(c.env.DB, regId);
    return success(c, { answers });
  } catch (err: any) {
    console.error('Get registration answers error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions/:id/question-answers - Get all answers grouped by question
adminRoutes.get('/missions/:id/question-answers', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) return Errors.notFound(c, 'Mission');

    const questionsWithAnswers = await getQuestionWithAnswers(c.env.DB, missionId);
    return success(c, { questions: questionsWithAnswers });
  } catch (err: any) {
    console.error('Get question answers error:', err);
    return Errors.internal(c);
  }
});

export { adminRoutes };
