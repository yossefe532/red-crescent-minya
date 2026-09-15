/**
 * Self-Cancel + Self-Restore + My-Registrations Routes
 *
 * Uses ownership_token (cookie) to identify device and its registrations.
 * No user login required — the device IS the identity.
 *
 * Self-restore logic:
 *   - If was CONFIRMED and seat available → CONFIRMED (next available seat)
 *   - If was CONFIRMED and no seat → WAITLIST (at END, preserving existing priority)
 *   - If was WAITLIST → WAITLIST (at END, preserving existing priority)
 *   - If mission closed → reject
 *   - If both full → reject
 *   - Idempotent: if already active, return current state
 */
import { Hono } from 'hono';
import { Env } from '../env';
import { success, Errors } from '../utils/response';
import { getOwnershipToken } from '../middleware/ownership';
import { cancelRegistration } from '../services/cancel.service';
import { logAudit } from '../services/audit.service';
import { createNotificationEvent } from '../services/notification_outbox';
import { incrementMissionVersion } from '../utils/version';

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

    // Phase 6: Increment mission version for live endpoint
    await incrementMissionVersion(c.env.DB, r.mission_id);

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

// ── POST /api/registrations/:regId/self-restore ───────────────
// Restore a cancelled registration owned by this device.
// Key difference from admin restore: NO promotion revocation.
// The volunteer simply joins at the end of the waitlist if no confirmed seat is available.
selfCancelRoutes.post('/registrations/:regId/self-restore', async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const ownershipToken = getOwnershipToken(c);

    if (!ownershipToken) {
      return Errors.unauthorized(c);
    }

    // 1. Fetch the registration
    const reg = await c.env.DB.prepare(
      `SELECT id, mission_id, status, seat_number, waitlist_position,
              original_status, ownership_token
       FROM registrations WHERE id = ?`,
    )
      .bind(regId)
      .first();

    if (!reg) return Errors.notFound(c, 'Registration');
    const r = reg as any;

    // 2. Verify ownership
    if (r.ownership_token !== ownershipToken) {
      return Errors.forbidden(c);
    }

    // 3. If already active (not CANCELLED), return current state (idempotent)
    if (r.status !== 'CANCELLED') {
      return success(c, {
        registration_id: regId,
        restored_status: r.status,
        seat_number: r.seat_number,
        waitlist_position: r.waitlist_position,
        message: r.status === 'CONFIRMED'
          ? 'تسجيلك مؤكد بالفعل'
          : r.status === 'WAITLIST'
            ? 'أنت في قائمة الانتظار بالفعل'
            : 'الحالة الحالية: ' + r.status,
      });
    }

    const missionId = r.mission_id;

    // 4. Check mission exists and is not closed
    const mission = await c.env.DB.prepare(
      `SELECT id, status, capacity, waiting_list FROM missions WHERE id = ?`,
    )
      .bind(missionId)
      .first();

    if (!mission) return Errors.notFound(c, 'Mission');
    const m = mission as any;

    if (m.status === 'CLOSED' || m.status === 'CANCELLED') {
      return Errors.conflict(c, 'المهمة مغلقة حالياً — لا يمكن استعادة التسجيل');
    }

    // 4b. Step 17: Re-evaluate requirements on restore
    // Only check if there are NEW required questions that the volunteer hasn't answered.
    // Requirements with requires_acceptance were already accepted at registration time — no need to re-check.
    const { getMissionQuestions, getRegistrationAnswers } = await import('../services/mission.requirements.service');
    const currentQuestions = await getMissionQuestions(c.env.DB, missionId);
    const existingAnswers = await getRegistrationAnswers(c.env.DB, regId);

    const missingQuestions: string[] = [];

    // Check required questions — does the volunteer have answers for them?
    const answerMap = new Map(existingAnswers.map(a => [a.question_id, a]));
    for (const q of currentQuestions) {
      if (q.required === 1) {
        const ans = answerMap.get(q.id);
        if (!ans || !ans.answer_text || ans.answer_text.trim() === '') {
          missingQuestions.push(q.question_text);
        }
      }
    }

    // If there are unmet required questions, block restore and inform volunteer
    if (missingQuestions.length > 0) {
      return c.json({
        success: false,
        error: {
          code: 'REQUIREMENTS_CHANGED',
          message: 'تغيرت متطلبات المهمة منذ إلغاء تسجيلك. يرجى التسجيل مرة أخرى.',
          missing_questions: missingQuestions,
        },
      }, 409);
    }

    // 5. Get current confirmed count (from BOTH tables)
    const officialCounts = await c.env.DB.prepare(
      `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
       FROM registrations WHERE mission_id = ?`,
    )
      .bind(missionId)
      .first();
    const tempCounts = await c.env.DB.prepare(
      `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
       FROM temporary_registrations WHERE mission_id = ?`,
    )
      .bind(missionId)
      .first();

    const totalConfirmed = ((officialCounts as any)?.confirmed || 0)
      + ((tempCounts as any)?.confirmed || 0);

    // 6. Get current waitlist count and max position
    const officialWaitlist = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt, COALESCE(MAX(waitlist_position), 0) as max_pos
       FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
    )
      .bind(missionId)
      .first();
    const tempWaitlist = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt, COALESCE(MAX(waitlist_position), 0) as max_pos
       FROM temporary_registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
    )
      .bind(missionId)
      .first();

    const totalWaitlistCount = ((officialWaitlist as any)?.cnt || 0)
      + ((tempWaitlist as any)?.cnt || 0);

    const waitingListCapacity = (m as any).waiting_list || 0;

    // 7. Determine restore outcome
    let restoredStatus: string;
    let newSeatNumber: number | null = null;
    let newWaitlistPosition: number | null = null;

    if (totalConfirmed < m.capacity) {
      // SCENARIO A: Confirmed seat available → restore as CONFIRMED.
      // ATOMIC: allocate the lowest free seat inside the UPDATE via a recursive-CTE
      // over BOTH tables. SQLite serializes writer statements, so two concurrent
      // CONFIRMED restores cannot both pick the same free seat (TOCTOU fix).
      // Note: capacity is coerced to an integer literal (m.capacity is a number from DB).
      const cap = Number(m.capacity) || 0;
      await c.env.DB.prepare(
        `UPDATE registrations
         SET status = 'CONFIRMED',
             seat_number = (
               WITH RECURSIVE nums(n) AS (
                 SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < ?
               ),
               taken AS (
                 SELECT seat_number FROM registrations
                   WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL
                 UNION
                 SELECT seat_number FROM temporary_registrations
                   WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL
               )
               SELECT MIN(n) FROM nums WHERE n NOT IN (SELECT seat_number FROM taken)
             ),
             waitlist_position = NULL,
             original_status = CASE WHEN original_status IS NULL THEN 'CONFIRMED' ELSE original_status END,
             restored_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(cap, missionId, missionId, regId)
        .run();

      // Read back the atomically-assigned seat for the response
      const after = await c.env.DB.prepare(
        `SELECT seat_number FROM registrations WHERE id = ?`,
      )
        .bind(regId)
        .first();

      const newSeat = (after as any)?.seat_number ?? null;
      if (!newSeat) {
        // Defensive: seat could not be allocated (should not happen after count check)
        return Errors.conflict(c, 'لا يوجد مقعد متاح');
      }

      restoredStatus = 'CONFIRMED';
      newSeatNumber = newSeat;
    } else if (waitingListCapacity === 0 || totalWaitlistCount >= waitingListCapacity) {
      // SCENARIO C: Both full → reject
      return Errors.conflict(c, 'المقاعد المؤكدة وقائمة الانتظار ممتلئتان حاليًا');
    } else {
      // SCENARIO B: No confirmed seat, but waitlist has room → WAITLIST at END.
      // ATOMIC: compute next position inside the UPDATE via scalar subquery over BOTH
      // tables. SQLite serializes writer statements, so two concurrent restores cannot
      // both read the same MAX and assign the same position (TOCTOU fix).
      await c.env.DB.prepare(
        `UPDATE registrations
         SET status = 'WAITLIST', seat_number = NULL,
             waitlist_position = (
               SELECT COALESCE(MAX(pos), 0) + 1 FROM (
                 SELECT waitlist_position AS pos FROM registrations
                   WHERE mission_id = ? AND status = 'WAITLIST'
                 UNION ALL
                 SELECT waitlist_position FROM temporary_registrations
                   WHERE mission_id = ? AND status = 'WAITLIST'
               ) p
             ),
             original_status = CASE WHEN original_status IS NULL THEN 'WAITLIST' ELSE original_status END,
             restored_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(missionId, missionId, regId)
        .run();

      // Read back the atomically-assigned position for the response
      const after = await c.env.DB.prepare(
        `SELECT waitlist_position FROM registrations WHERE id = ?`,
      )
        .bind(regId)
        .first();

      restoredStatus = 'WAITLIST';
      newWaitlistPosition = (after as any)?.waitlist_position ?? null;
    }

    // 8. Audit log
    await logAudit(c.env.DB, {
      actorId: ownershipToken,
      actorType: 'volunteer',
      action: 'REGISTRATION_SELF_RESTORED',
      entityType: 'registration',
      entityId: regId,
      metadata: {
        mission_id: missionId,
        restored_status: restoredStatus,
        seat_number: newSeatNumber,
        waitlist_position: newWaitlistPosition,
      },
    });

    // 9. Increment mission version for live change detection
    await incrementMissionVersion(c.env.DB, missionId);

    // 10. Queue Telegram notification
    try {
      const chatId = (c.env.ADMIN_CHAT_IDS || '').split(',')[0].trim();
      if (chatId) {
        const missionInfo = await c.env.DB.prepare(
          `SELECT title, public_code FROM missions WHERE id = ?`,
        )
          .bind(missionId)
          .first();

        const mi = missionInfo as any;
        let text = `↩️ <b>استعادة ذاتية</b>\n\n`;
        text += `📋 المهمة: ${mi?.public_code || ''} (${mi?.title || ''})\n`;
        text += `status: ${restoredStatus}`;
        if (newSeatNumber) text += ` | المقعد: #${newSeatNumber}`;
        if (newWaitlistPosition) text += ` | موقع الانتظار: #${newWaitlistPosition}`;

        await createNotificationEvent(c.env.DB, {
          eventType: 'REGISTRATION_RESTORED',
          registrationId: regId,
          missionId,
          adminChatId: chatId,
          payload: JSON.stringify({ text, chat_id: chatId }),
        });
      }
    } catch (outboxErr) {
      console.error('[OUTBOX] Failed to queue self-restore notification:', outboxErr);
    }

    return success(c, {
      registration_id: regId,
      restored_status: restoredStatus,
      seat_number: newSeatNumber,
      waitlist_position: newWaitlistPosition,
      message: restoredStatus === 'CONFIRMED'
        ? `تم استعادة تسجيلك — مقعد مؤكد #${newSeatNumber}`
        : `تمت إضافتك لقائمة الانتظار — موقع #${newWaitlistPosition}`,
    });
  } catch (err: any) {
    console.error('Self-restore error:', err);
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

    // Increment mission version
    await incrementMissionVersion(c.env.DB, r.mission_id);

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

// ── POST /api/temporary-registrations/:regId/self-restore ─────
// Restore a cancelled temporary registration owned by this device.
selfCancelRoutes.post('/temporary-registrations/:regId/self-restore', async (c) => {
  try {
    const regId = c.req.param('regId') as string;
    const ownershipToken = getOwnershipToken(c);

    if (!ownershipToken) {
      return Errors.unauthorized(c);
    }

    // 1. Fetch the temporary registration
    const reg = await c.env.DB.prepare(
      `SELECT id, mission_id, status, seat_number, waitlist_position,
              original_status, ownership_token
       FROM temporary_registrations WHERE id = ?`,
    )
      .bind(regId)
      .first();

    if (!reg) return Errors.notFound(c, 'Registration');
    const r = reg as any;

    // 2. Verify ownership
    if (r.ownership_token !== ownershipToken) {
      return Errors.forbidden(c);
    }

    // 3. If already active (not CANCELLED), return current state (idempotent)
    if (r.status !== 'CANCELLED') {
      return success(c, {
        registration_id: regId,
        restored_status: r.status,
        seat_number: r.seat_number,
        waitlist_position: r.waitlist_position,
        message: r.status === 'CONFIRMED'
          ? 'تسجيلك مؤكد بالفعل'
          : r.status === 'WAITLIST'
            ? 'أنت في قائمة الانتظار بالفعل'
            : 'الحالة الحالية: ' + r.status,
      });
    }

    const missionId = r.mission_id;

    // 4. Check mission exists and is not closed
    const mission = await c.env.DB.prepare(
      `SELECT id, status, capacity, waiting_list FROM missions WHERE id = ?`,
    )
      .bind(missionId)
      .first();

    if (!mission) return Errors.notFound(c, 'Mission');
    const m = mission as any;

    if (m.status === 'CLOSED' || m.status === 'CANCELLED') {
      return Errors.conflict(c, 'المهمة مغلقة حالياً — لا يمكن استعادة التسجيل');
    }

    // 5. Get current counts (from BOTH tables)
    const officialCounts = await c.env.DB.prepare(
      `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
       FROM registrations WHERE mission_id = ?`,
    )
      .bind(missionId)
      .first();
    const tempCounts = await c.env.DB.prepare(
      `SELECT COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
       FROM temporary_registrations WHERE mission_id = ?`,
    )
      .bind(missionId)
      .first();

    const totalConfirmed = ((officialCounts as any)?.confirmed || 0)
      + ((tempCounts as any)?.confirmed || 0);

    // 6. Get current waitlist count (for capacity check; position is now computed atomically in UPDATE)
    const officialWaitlistCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
    )
      .bind(missionId)
      .first();
    const tempWaitlistCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as cnt FROM temporary_registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
    )
      .bind(missionId)
      .first();
    const totalWaitlistCount = ((officialWaitlistCount as any)?.cnt || 0)
      + ((tempWaitlistCount as any)?.cnt || 0);

    const waitingListCapacity = m.waiting_list || 0;

    // 7. Determine restore outcome
    let restoredStatus: string;
    let newSeatNumber: number | null = null;
    let newWaitlistPosition: number | null = null;

    if (totalConfirmed < m.capacity) {
      // SCENARIO A: Confirmed seat available → restore as CONFIRMED.
      // ATOMIC: allocate the lowest free seat inside the UPDATE via a recursive-CTE
      // over BOTH tables. SQLite serializes writer statements, so two concurrent
      // CONFIRMED restores cannot both pick the same free seat (TOCTOU fix).
      const cap = Number(m.capacity) || 0;
      await c.env.DB.prepare(
        `UPDATE temporary_registrations
         SET status = 'CONFIRMED',
             seat_number = (
               WITH RECURSIVE nums(n) AS (
                 SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < ?
               ),
               taken AS (
                 SELECT seat_number FROM registrations
                   WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL
                 UNION
                 SELECT seat_number FROM temporary_registrations
                   WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL
               )
               SELECT MIN(n) FROM nums WHERE n NOT IN (SELECT seat_number FROM taken)
             ),
             waitlist_position = NULL,
             original_status = CASE WHEN original_status IS NULL THEN 'CONFIRMED' ELSE original_status END,
             restored_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(cap, missionId, missionId, regId)
        .run();

      // Read back the atomically-assigned seat for the response
      const after = await c.env.DB.prepare(
        `SELECT seat_number FROM temporary_registrations WHERE id = ?`,
      )
        .bind(regId)
        .first();

      const newSeat = (after as any)?.seat_number ?? null;
      if (!newSeat) {
        // Defensive: seat could not be allocated (should not happen after count check)
        return Errors.conflict(c, 'لا يوجد مقعد متاح');
      }

      restoredStatus = 'CONFIRMED';
      newSeatNumber = newSeat;
    } else if (waitingListCapacity === 0 || totalWaitlistCount >= waitingListCapacity) {
      // SCENARIO C: Both full
      return Errors.conflict(c, 'المقاعد المؤكدة وقائمة الانتظار ممتلئتان حاليًا');
    } else {
      // SCENARIO B: No confirmed seat, waitlist has room → WAITLIST at END.
      // ATOMIC: assign the next position inside the UPDATE (scalar subquery over
      // BOTH tables). SQLite serializes writers, so concurrent restores cannot
      // both compute the same max+1 (TOCTOU fix).
      await c.env.DB.prepare(
        `UPDATE temporary_registrations
         SET status = 'WAITLIST', seat_number = NULL,
             waitlist_position = (
               SELECT COALESCE(MAX(pos), 0) + 1 FROM (
                 SELECT waitlist_position AS pos FROM registrations
                   WHERE mission_id = ? AND status = 'WAITLIST'
                 UNION ALL
                 SELECT waitlist_position AS pos FROM temporary_registrations
                   WHERE mission_id = ? AND status = 'WAITLIST'
               )
             ),
             original_status = CASE WHEN original_status IS NULL THEN 'WAITLIST' ELSE original_status END,
             restored_at = datetime('now')
         WHERE id = ?`,
      )
        .bind(missionId, missionId, regId)
        .run();

      // Read back the atomically-assigned position for the response
      const after = await c.env.DB.prepare(
        `SELECT waitlist_position FROM temporary_registrations WHERE id = ?`,
      )
        .bind(regId)
        .first();

      restoredStatus = 'WAITLIST';
      newWaitlistPosition = (after as any)?.waitlist_position ?? null;
    }

    // 8. Audit log
    await logAudit(c.env.DB, {
      actorId: ownershipToken,
      actorType: 'volunteer',
      action: 'REGISTRATION_SELF_RESTORED',
      entityType: 'registration',
      entityId: regId,
      metadata: {
        mission_id: missionId,
        restored_status: restoredStatus,
        seat_number: newSeatNumber,
        waitlist_position: newWaitlistPosition,
      },
    });

    // 9. Increment mission version
    await incrementMissionVersion(c.env.DB, missionId);

    return success(c, {
      registration_id: regId,
      restored_status: restoredStatus,
      seat_number: newSeatNumber,
      waitlist_position: newWaitlistPosition,
      message: restoredStatus === 'CONFIRMED'
        ? `تم استعادة تسجيلك — مقعد مؤكد #${newSeatNumber}`
        : `تمت إضافتك لقائمة الانتظار — موقع #${newWaitlistPosition}`,
    });
  } catch (err: any) {
    console.error('Temp self-restore error:', err);
    return Errors.internal(c);
  }
});

export { selfCancelRoutes };
