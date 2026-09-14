/**
 * Cancel Service — Shared cancellation + waitlist promotion logic.
 *
 * Used by:
 *   - Admin cancel   (admin.ts)
 *   - Self cancel    (self-cancel.ts)
 *   - Telegram cancel (future)
 *
 * Ensures consistent behavior: atomically cancel → promote → reorder waitlist.
 */

export interface CancelResult {
  registration_id: string;
  status_before: string;
  seat_number: number | null;
  promoted_volunteer: {
    registration_id: string;
    name: string;
    member_id: string;
    new_seat_number: number;
  } | null;
}

/**
 * Cancel a registration and promote the first waitlisted volunteer if applicable.
 *
 * @param db          D1 database binding
 * @param regId       Registration ID to cancel
 * @param cancelledBy Who initiated: 'admin' | 'self' | 'system'
 * @param seatNumber  The seat number that was occupied (read from the registration)
 * @returns CancelResult with promotion info if applicable
 */
export async function cancelRegistration(
  db: D1Database,
  regId: string,
  cancelledBy: 'admin' | 'self' | 'system',
): Promise<CancelResult> {
  // 1. Fetch the current registration
  const reg = await db
    .prepare(
      `SELECT id, mission_id, status, seat_number, waitlist_position, volunteer_id
       FROM registrations WHERE id = ?`,
    )
    .bind(regId)
    .first();

  if (!reg) throw new Error('REGISTRATION_NOT_FOUND');

  const r = reg as any;
  if (r.status === 'CANCELLED') throw new Error('ALREADY_CANCELLED');

  const missionId = r.mission_id;
  const statusBefore = r.status;

  // 2. Record original_status on first cancellation
  await db
    .prepare(
      `UPDATE registrations
       SET status = 'CANCELLED',
           cancelled_at = datetime('now'),
           cancelled_by = ?,
           original_status = CASE WHEN original_status IS NULL THEN ? ELSE original_status END
       WHERE id = ?`,
    )
    .bind(cancelledBy, statusBefore, regId)
    .run();

  // 3. If was CONFIRMED and held a seat → promote first waitlisted
  let promotedVolunteer: CancelResult['promoted_volunteer'] = null;

  if (statusBefore === 'CONFIRMED' && r.seat_number) {
    const firstWaitlist = await db
      .prepare(
        `SELECT r.id, r.waitlist_position, v.name, v.member_id
         FROM registrations r
         JOIN volunteers v ON v.id = r.volunteer_id
         WHERE r.mission_id = ? AND r.status = 'WAITLIST'
         ORDER BY r.waitlist_position ASC
         LIMIT 1`,
      )
      .bind(missionId)
      .first();

    if (firstWaitlist) {
      const wl = firstWaitlist as any;

      // Promote
      await db
        .prepare(
          `UPDATE registrations
           SET status = 'CONFIRMED',
               seat_number = ?,
               waitlist_position = NULL,
               confirmed_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(r.seat_number, wl.id)
        .run();

      // Reorder remaining waitlist
      await db
        .prepare(
          `UPDATE registrations
           SET waitlist_position = waitlist_position - 1
           WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`,
        )
        .bind(missionId, wl.waitlist_position)
        .run();

      promotedVolunteer = {
        registration_id: wl.id,
        name: wl.name,
        member_id: wl.member_id,
        new_seat_number: r.seat_number,
      };
    }
  }

  // 4. Reorder waitlist if was on waitlist
  if (statusBefore === 'WAITLIST' && r.waitlist_position) {
    await db
      .prepare(
        `UPDATE registrations
         SET waitlist_position = waitlist_position - 1
         WHERE mission_id = ? AND status = 'WAITLIST' AND waitlist_position > ?`,
      )
      .bind(missionId, r.waitlist_position)
      .run();
  }

  return {
    registration_id: regId,
    status_before: statusBefore,
    seat_number: r.seat_number,
    promoted_volunteer: promotedVolunteer,
  };
}
