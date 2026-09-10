import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { success, Errors } from '../utils/response';
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
      // Open registration: set open_at to now, close_at to end_at
      updates.registration_open_at = nowIso;
      updates.registration_close_at = mission.end_at;
      updates.status = 'OPEN';
    } else {
      // Close registration: set close_at to now
      updates.registration_close_at = nowIso;
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

// POST /api/admin/missions/:id/cancel/:regId - Cancel a specific registration
adminRoutes.post('/missions/:id/cancel/:regId', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const regId = c.req.param('regId') as string;

    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    // Check if registration exists
    const reg = await c.env.DB.prepare(
      `SELECT id, status, seat_number FROM registrations WHERE id = ? AND mission_id = ?`
    )
      .bind(regId, missionId)
      .first();

    if (!reg) {
      return Errors.notFound(c, 'Registration');
    }

    const regData = reg as any;
    if (regData.status === 'CANCELLED') {
      return Errors.conflict(c, 'التسجيل ملغي بالفعل');
    }

    // Cancel the registration
    await c.env.DB.prepare(
      `UPDATE registrations 
       SET status = 'CANCELLED', cancelled_at = datetime('now')
       WHERE id = ?`
    )
      .bind(regId)
      .run();

    // If it was a confirmed seat, promote first waitlist volunteer
    if (regData.status === 'CONFIRMED' && regData.seat_number) {
      const firstWaitlist = await c.env.DB.prepare(
        `SELECT id, waitlist_position FROM registrations 
         WHERE mission_id = ? AND status = 'WAITLIST'
         ORDER BY waitlist_position ASC
         LIMIT 1`
      )
        .bind(missionId)
        .first();

      if (firstWaitlist) {
        const wlData = firstWaitlist as any;
        await c.env.DB.prepare(
          `UPDATE registrations 
           SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now')
           WHERE id = ?`
        )
          .bind(regData.seat_number, wlData.id)
          .run();

        // Reorder remaining waitlist
        await c.env.DB.prepare(
          `UPDATE registrations 
           SET waitlist_position = waitlist_position - 1
           WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`
        )
          .bind(missionId, wlData.waitlist_position)
          .run();
      }
    }

    const adminId = getAdminId(c);
    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REGISTRATION_CANCELLED',
      entityType: 'registration',
      entityId: regId,
      metadata: { missionId, seatNumber: regData.seat_number },
    });

    return success(c, { message: 'تم إلغاء التسجيل بنجاح' });
  } catch (err: any) {
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
        const date = new Date(r.created_at).toLocaleString('ar-EG');
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

export { adminRoutes };
