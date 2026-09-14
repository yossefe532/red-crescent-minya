/**
 * Self-Cancel + My-Registrations Routes
 *
 * Uses ownership_token (cookie) to identify device and its registrations.
 * No user login required — the device IS the identity.
 */
import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { getOwnershipToken } from '../middleware/ownership';
import { cancelRegistration } from '../services/cancel.service';
import { logAudit } from '../services/audit.service';
import { createNotificationEvent } from '../services/notification_outbox';

const selfCancelRoutes = new Hono<{ Bindings: Env }>();

// ── GET /api/missions/:publicCode/my-registrations ────────────
// Returns all registrations created by this device for the given mission.
selfCancelRoutes.get('/missions/:publicCode/my-registrations', async (c) => {
  try {
    const publicCode = c.req.param('publicCode');
    const ownershipToken = getOwnershipToken(c);

    if (!ownershipToken) {
      return success(c, []); // No token → no registrations
    }

    // Find mission
    const mission = await c.env.DB.prepare(
      `SELECT id FROM missions WHERE public_code = ?`,
    )
      .bind(publicCode)
      .first();

    if (!mission) return Errors.notFound(c, 'Mission');

    const missionId = (mission as any).id;

    // Official registrations (with member_id)
    const official = await c.env.DB.prepare(
      `SELECT r.id, r.status, r.seat_number, r.waitlist_position,
              r.registration_sequence, r.created_at, r.cancelled_at,
              v.name, v.member_id
       FROM registrations r
       JOIN volunteers v ON v.id = r.volunteer_id
       WHERE r.mission_id = ? AND r.ownership_token = ?
       ORDER BY r.registration_sequence ASC`,
    )
      .bind(missionId, ownershipToken)
      .all();

    // Temporary registrations (without member_id)
    const temporary = await c.env.DB.prepare(
      `SELECT id, status, seat_number, waitlist_position,
              registration_sequence, created_at, cancelled_at,
              name, NULL as member_id
       FROM temporary_registrations
       WHERE mission_id = ? AND ownership_token = ?
       ORDER BY registration_sequence ASC`,
    )
      .bind(missionId, ownershipToken)
      .all();

    const all = [
      ...(official.results || []),
      ...(temporary.results || []),
    ].sort((a: any, b: any) => a.registration_sequence - b.registration_sequence);

    return success(c, all);
  } catch (err: any) {
    console.error('My registrations error:', err);
    return Errors.internal(c);
  }
});

// ── POST /api/registrations/:regId/self-cancel ────────────────
// Cancel a registration owned by this device.
selfCancelRoutes.post('/registrations/:regId/self-cancel', async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const ownershipToken = getOwnershipToken(c);

    if (!ownershipToken) {
      return Errors.unauthorized(c);
    }

    // Verify ownership: check official registrations
    const reg = await c.env.DB.prepare(
      `SELECT id, mission_id, status, seat_number, ownership_token
       FROM registrations WHERE id = ?`,
    )
      .bind(regId)
      .first();

    if (!reg) return Errors.notFound(c, 'Registration');
    const r = reg as any;

    // Verify this device owns this registration
    if (r.ownership_token !== ownershipToken) {
      return Errors.forbidden(c);
    }

    if (r.status === 'CANCELLED') {
      return Errors.conflict(c, 'التسجيل ملغي بالفعل');
    }

    // Cancel via shared service
    const result = await cancelRegistration(c.env.DB, regId, 'self');

    // Audit log
    await logAudit(c.env.DB, {
      actorId: r.ownership_token,
      actorType: 'volunteer',
      action: 'REGISTRATION_SELF_CANCELLED',
      entityType: 'registration',
      entityId: regId,
      metadata: {
        mission_id: r.mission_id,
        seat_number: r.seat_number,
        promoted: result.promoted_volunteer?.registration_id || null,
      },
    });

    // Queue Telegram notification
    try {
      const chatId = (c.env.ADMIN_CHAT_IDS || '').split(',')[0].trim();
      if (chatId) {
        const mission = await c.env.DB.prepare(
          `SELECT title, public_code FROM missions WHERE id = ?`,
        )
          .bind(r.mission_id)
          .first();

        const m = mission as any;
        let text = `❌ <b>إلغاء ذاتي</b>\n\n`;
        text += `📋 المهمة: ${m?.public_code || ''} (${m?.title || ''})\n`;
        text += `💺 المقعد: ${r.seat_number ? `#${r.seat_number}` : 'انتظار'}`;

        if (result.promoted_volunteer) {
          text += `\n\n⬆️ تم ترقيعة ${result.promoted_volunteer.name} → المقعد ${result.promoted_volunteer.new_seat_number}`;
        }

        await createNotificationEvent(c.env.DB, {
          eventType: 'REGISTRATION_CANCELLED',
          registrationId: regId,
          missionId: r.mission_id,
          adminChatId: chatId,
          payload: JSON.stringify({ text, chat_id: chatId }),
        });
      }
    } catch (outboxErr) {
      console.error('[OUTBOX] Failed to queue self-cancel notification:', outboxErr);
    }

    return success(c, {
      cancelled_registration_id: regId,
      promoted_volunteer: result.promoted_volunteer,
      message: result.promoted_volunteer
        ? `تم إلغاء التسجيل وترقية ${result.promoted_volunteer.name}`
        : 'تم إلغاء التسجيل بنجاح',
    });
  } catch (err: any) {
    if (err.message === 'ALREADY_CANCELLED') {
      return Errors.conflict(c, 'التسجيل ملغي بالفعل');
    }
    console.error('Self-cancel error:', err);
    return Errors.internal(c);
  }
});

// ── POST /api/temporary-registrations/:regId/self-cancel ──────
// Cancel a temporary registration owned by this device.
selfCancelRoutes.post('/temporary-registrations/:regId/self-cancel', async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const ownershipToken = getOwnershipToken(c);

    if (!ownershipToken) {
      return Errors.unauthorized(c);
    }

    // Verify ownership
    const reg = await c.env.DB.prepare(
      `SELECT id, mission_id, status, seat_number, waitlist_position, ownership_token
       FROM temporary_registrations WHERE id = ?`,
    )
      .bind(regId)
      .first();

    if (!reg) return Errors.notFound(c, 'Registration');
    const r = reg as any;

    if (r.ownership_token !== ownershipToken) {
      return Errors.forbidden(c);
    }

    if (r.status === 'CANCELLED') {
      return Errors.conflict(c, 'التسجيل ملغي بالفعل');
    }

    const statusBefore = r.status;

    // Cancel
    await c.env.DB.prepare(
      `UPDATE temporary_registrations
       SET status = 'CANCELLED',
           cancelled_at = datetime('now'),
           cancelled_by = 'self',
           original_status = CASE WHEN original_status IS NULL THEN ? ELSE original_status END
       WHERE id = ?`,
    )
      .bind(statusBefore, regId)
      .run();

    // Promote from waitlist if was confirmed
    let promotedVolunteer = null;
    if (statusBefore === 'CONFIRMED' && r.seat_number) {
      const firstWaitlist = await c.env.DB.prepare(
        `SELECT id, waitlist_position, name FROM temporary_registrations
         WHERE mission_id = ? AND status = 'WAITLIST'
         ORDER BY waitlist_position ASC LIMIT 1`,
      )
        .bind(r.mission_id)
        .first();

      if (firstWaitlist) {
        const wl = firstWaitlist as any;
        await c.env.DB.prepare(
          `UPDATE temporary_registrations
           SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL,
               confirmed_at = datetime('now')
           WHERE id = ?`,
        )
          .bind(r.seat_number, wl.id)
          .run();

        await c.env.DB.prepare(
          `UPDATE temporary_registrations
           SET waitlist_position = waitlist_position - 1
           WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`,
        )
          .bind(r.mission_id, wl.waitlist_position)
          .run();

        promotedVolunteer = {
          registration_id: wl.id,
          name: wl.name,
          new_seat_number: r.seat_number,
        };
      }
    }

    return success(c, {
      cancelled_registration_id: regId,
      promoted_volunteer: promotedVolunteer,
      message: promotedVolunteer
        ? `تم إلغاء التسجيل وترقية ${promotedVolunteer.name}`
        : 'تم إلغاء التسجيل المؤقت بنجاح',
    });
  } catch (err: any) {
    console.error('Temp self-cancel error:', err);
    return Errors.internal(c);
  }
});

export { selfCancelRoutes };
