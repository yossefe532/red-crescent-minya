import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { success, error, Errors } from '../utils/response';
import { loginSchema, createMissionSchema, updateMissionSchema } from '../validation/admin.schema';
import { authenticateAdmin } from '../services/admin.service';
import { createSession, destroySession, adminAuth, getAdminId } from '../middleware/auth';
import { logAudit } from '../services/audit.service';
import { 
  listMissions, 
  getMissionById, 
  createMission, 
  updateMission, 
  deleteMission, 
  getMissionAvailability 
} from '../services/mission.service';

const adminRoutes = new Hono<AppEnv>();

// POST /api/admin/login
adminRoutes.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.validation(c, parsed.error.issues);
    }

    const { username, password } = parsed.data;
    const admin = await authenticateAdmin(c.env.DB, username, password);
    if (!admin) {
      return Errors.unauthorized(c);
    }

    const sessionToken = await createSession(admin.id, admin.username, c.env);
    c.res.headers.set(
      'Set-Cookie', 
      `rc_session=${sessionToken}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`
    );

    await logAudit(c.env.DB, {
      actorId: admin.id,
      actorType: 'admin',
      action: 'ADMIN_LOGIN',
      entityType: 'admin',
      entityId: admin.id,
    });

    return success(c, {
      admin_id: admin.id,
      username: admin.username,
      display_name: admin.display_name,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/logout
adminRoutes.post('/logout', adminAuth, async (c) => {
  const cookie = c.req.header('cookie');
  const match = cookie?.match(/rc_session=([^;]+)/);
  if (match) {
    await destroySession(match[1].trim(), c.env);
  }
  c.res.headers.set('Set-Cookie', 'rc_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  return success(c, { message: 'Logged out successfully.' });
});

// POST /api/admin/missions - Create mission
adminRoutes.post('/missions', adminAuth, async (c) => {
  try {
    const body = await c.req.json();
    const parsed = createMissionSchema.safeParse(body);
    if (!parsed.success) {
      return Errors.validation(c, parsed.error.issues);
    }

    const adminId = getAdminId(c);
    const mission = await createMission(c.env.DB, parsed.data, adminId);

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'MISSION_CREATED',
      entityType: 'mission',
      entityId: mission.id,
      metadata: { title: mission.title, capacity: mission.capacity, public_code: mission.public_code },
    });

    const frontendUrl = c.env.FRONTEND_URL || 'http://localhost:5173';
    const publicUrl = `${frontendUrl}/m/${mission.public_code}`;
    const whatsappMessage = `صباح الخير متطوعينا الكرام\n\nعندنا ${mission.title}\n\nالتسجيل يتم من خلال الرابط التالي:\n${publicUrl}\n\nبرجاء التسجيل بنفسك وعدم التسجيل بالنيابة عن أي متطوع آخر.`;

    return success(c, {
      id: mission.id,
      public_code: mission.public_code,
      title: mission.title,
      confirmation_phrase: mission.confirmation_phrase,
      public_url: publicUrl,
      whatsapp_message: whatsappMessage,
    }, 201);
  } catch (err: any) {
    console.error('CREATE MISSION ERROR:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions - List missions
adminRoutes.get('/missions', adminAuth, async (c) => {
  try {
    const status = c.req.query('status') || undefined;
    const page = parseInt(c.req.query('page') || '1', 10);
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const offset = (page - 1) * limit;

    const result = await listMissions(c.env.DB, { status, limit, offset });
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

// PATCH /api/admin/missions/:id - Update mission
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

// GET /api/admin/missions/:id/registrations - List registrations for mission
adminRoutes.get('/missions/:id/registrations', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const status = c.req.query('status') || undefined;
    const search = c.req.query('search') || undefined;

    let query = `
      SELECT r.id, r.mission_id, r.volunteer_id, r.status, r.seat_number, 
             r.waitlist_position, r.registration_sequence, r.created_at, r.confirmed_at,
             v.name as volunteer_name, v.member_id,
             a.id as audio_id, a.phrase, a.duration_ms
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      LEFT JOIN audio_confirmations a ON a.registration_id = r.id
      WHERE r.mission_id = ?
    `;
    const params: (string | number)[] = [missionId];

    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (v.name LIKE ? OR v.member_id LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY r.registration_sequence ASC';

    const result = await c.env.DB.prepare(query).bind(...params).all();

    const counts = await c.env.DB.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed,
        COUNT(CASE WHEN status = 'WAITLIST' THEN 1 END) as waitlist,
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END) as cancelled
      FROM registrations
      WHERE mission_id = ?
    `).bind(missionId).first();

    return success(c, {
      registrations: result.results || [],
      total: (result.results || []).length,
      confirmed: (counts as any)?.confirmed || 0,
      waitlist: (counts as any)?.waitlist || 0,
      cancelled: (counts as any)?.cancelled || 0,
    });
  } catch (err: any) {
    console.error('Get registrations error:', err);
    return Errors.internal(c);
  }
});

// POST /api/admin/registrations/:id/cancel - Cancel registration & auto-promote first waitlisted
adminRoutes.post('/registrations/:id/cancel', adminAuth, async (c) => {
  try {
    const regId = c.req.param('id') as string;
    const adminId = getAdminId(c);

    // Fetch existing registration
    const existing = await c.env.DB.prepare(`
      SELECT r.*, v.name as volunteer_name, v.member_id, m.public_code
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      JOIN missions m ON m.id = r.mission_id
      WHERE r.id = ?
    `).bind(regId).first();

    if (!existing) {
      return Errors.notFound(c, 'Registration');
    }

    const reg = existing as any;
    if (reg.status === 'CANCELLED') {
      return Errors.conflict(c, 'هذا التسجيل ملغي بالفعل.');
    }

    const prevStatus = reg.status;
    const releasedSeatNumber = reg.seat_number;
    const missionId = reg.mission_id;

    // 1. Mark target registration as CANCELLED
    await c.env.DB.prepare(`
      UPDATE registrations 
      SET status = 'CANCELLED', seat_number = NULL, waitlist_position = NULL, cancelled_at = datetime('now')
      WHERE id = ?
    `).bind(regId).run();

    await logAudit(c.env.DB, {
      actorId: adminId,
      actorType: 'admin',
      action: 'REGISTRATION_CANCELLED',
      entityType: 'registration',
      entityId: regId,
      metadata: {
        mission_id: missionId,
        volunteer_name: reg.volunteer_name,
        member_id: reg.member_id,
        previous_status: prevStatus,
        released_seat: releasedSeatNumber,
      }
    });

    let promotedVolunteer = null;

    // 2. If a CONFIRMED seat was cancelled, automatically promote the first waitlisted volunteer!
    if (prevStatus === 'CONFIRMED') {
      const firstWaitlisted = await c.env.DB.prepare(`
        SELECT r.id, r.volunteer_id, v.name, v.member_id
        FROM registrations r
        JOIN volunteers v ON v.id = r.volunteer_id
        WHERE r.mission_id = ? AND r.status = 'WAITLIST'
        ORDER BY r.waitlist_position ASC
        LIMIT 1
      `).bind(missionId).first();

      if (firstWaitlisted) {
        const candidate = firstWaitlisted as any;
        const newSeat = releasedSeatNumber || 1;

        // Promote to CONFIRMED
        await c.env.DB.prepare(`
          UPDATE registrations
          SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL, confirmed_at = datetime('now')
          WHERE id = ?
        `).bind(newSeat, candidate.id).run();

        // Shift remaining waitlist positions down by 1
        await c.env.DB.prepare(`
          UPDATE registrations
          SET waitlist_position = waitlist_position - 1
          WHERE mission_id = ? AND status = 'WAITLIST'
        `).bind(missionId).run();

        promotedVolunteer = {
          registration_id: candidate.id,
          name: candidate.name,
          member_id: candidate.member_id,
          new_seat_number: newSeat,
        };

        await logAudit(c.env.DB, {
          actorId: adminId,
          actorType: 'system',
          action: 'WAITLIST_AUTO_PROMOTED',
          entityType: 'registration',
          entityId: candidate.id,
          metadata: {
            mission_id: missionId,
            volunteer_name: candidate.name,
            member_id: candidate.member_id,
            promoted_to_seat: newSeat,
          }
        });
      }
    } else if (prevStatus === 'WAITLIST') {
      // If a WAITLIST volunteer was cancelled, shift succeeding waitlist numbers
      const cancelledWaitlistPos = reg.waitlist_position;
      if (cancelledWaitlistPos) {
        await c.env.DB.prepare(`
          UPDATE registrations
          SET waitlist_position = waitlist_position - 1
          WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?
        `).bind(missionId, cancelledWaitlistPos).run();
      }
    }

    return success(c, {
      cancelled_registration_id: regId,
      status: 'CANCELLED',
      promoted_volunteer: promotedVolunteer,
      message: promotedVolunteer 
        ? `تم إلغاء التسجيل وترقية المتطوع (${promotedVolunteer.name}) من قائمة الانتظار للمقعد رقم ${promotedVolunteer.new_seat_number}`
        : 'تم إلغاء التسجيل بنجاح.',
    });

  } catch (err: any) {
    console.error('Cancel registration error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/registrations/:id/audio - Stream audio recording
adminRoutes.get('/registrations/:id/audio', adminAuth, async (c) => {
  try {
    const regId = c.req.param('id');

    const record = await c.env.DB.prepare(`
      SELECT audio_key, mime_type, phrase
      FROM audio_confirmations
      WHERE registration_id = ?
    `).bind(regId).first();

    if (!record) {
      return Errors.notFound(c, 'Audio confirmation');
    }

    const audioKey = (record as any).audio_key;
    const mimeType = (record as any).mime_type || 'audio/webm';

    const object = await c.env.AUDIO_BUCKET.get(audioKey);
    if (!object) {
      return Errors.notFound(c, 'Audio file in storage');
    }

    const headers = new Headers();
    headers.set('Content-Type', mimeType);
    headers.set('Cache-Control', 'private, max-age=3600');
    headers.set('Content-Disposition', `inline; filename="recording-${regId}.webm"`);

    return new Response(object.body, { headers });
  } catch (err: any) {
    console.error('Fetch audio error:', err);
    return Errors.internal(c);
  }
});

// GET /api/admin/missions/:id/export - CSV Export
adminRoutes.get('/missions/:id/export', adminAuth, async (c) => {
  try {
    const missionId = c.req.param('id') as string;
    const mission = await getMissionById(c.env.DB, missionId);
    if (!mission) {
      return Errors.notFound(c, 'Mission');
    }

    const query = `
      SELECT r.registration_sequence, v.name, v.member_id, r.status, 
             r.seat_number, r.waitlist_position, r.created_at,
             CASE WHEN a.id IS NOT NULL THEN 'نعم' ELSE 'لا' END as has_audio
      FROM registrations r
      JOIN volunteers v ON v.id = r.volunteer_id
      LEFT JOIN audio_confirmations a ON a.registration_id = r.id
      WHERE r.mission_id = ?
      ORDER BY r.registration_sequence ASC
    `;

    const result = await c.env.DB.prepare(query).bind(missionId).all();
    const rows = result.results || [];

    // Build CSV with UTF-8 BOM for Arabic support in Excel
    const BOM = '\uFEFF';
    const headers = ['التسلسل', 'الاسم', 'رقم العضوية', 'الحالة', 'رقم المقعد', 'موقع الانتظار', 'وقت التسجيل', 'تسجيل صوتي'];
    
    const csvLines = [
      headers.join(','),
      ...rows.map((row: any) => [
        row.registration_sequence,
        `"${(row.name || '').replace(/"/g, '""')}"`,
        `"${(row.member_id || '').replace(/"/g, '""')}"`,
        `"${row.status}"`,
        row.seat_number ?? '',
        row.waitlist_position ?? '',
        `"${row.created_at}"`,
        `"${row.has_audio}"`,
      ].join(','))
    ];

    const csvContent = BOM + csvLines.join('\r\n');

    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="mission-${mission.public_code}-participants.csv"`,
      },
    });

  } catch (err: any) {
    console.error('Export CSV error:', err);
    return Errors.internal(c);
  }
});

export { adminRoutes };
