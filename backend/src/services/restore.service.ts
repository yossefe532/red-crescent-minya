/**
 * Restore Service — Restore a cancelled registration.
 *
 * Admin-only operation. Handles both registrations and temporary_registrations.
 * Logic:
 * 1. If was CONFIRMED → restore directly if seat available
 * 2. If no seat → revoke most recent promotion, restore original
 * 3. If was WAITLIST → restore with next available waitlist position
 *
 * Increments mission version for live change detection (Phase 6).
 */
import { logAudit } from './audit.service';
import { incrementMissionVersion } from '../utils/version';

export interface RestoreResult {
  registration_id: string;
  restored_status: string;
  revoked_promotion: {
    registration_id: string;
    name: string;
    demoted_to: 'WAITLIST';
  } | null;
}

/**
 * Restore a cancelled registration.
 *
 * @param db      D1 database binding
 * @param regId   Registration ID to restore
 * @param adminId Admin who performed the restore
 * @returns RestoreResult
 */
export async function restoreRegistration(
  db: D1Database,
  regId: string,
  adminId: string,
): Promise<RestoreResult> {
  // 1. Fetch the cancelled registration (only from registrations table)
  const reg = await db
    .prepare(
      `SELECT id, mission_id, status, seat_number, waitlist_position, original_status, volunteer_id
       FROM registrations WHERE id = ?`,
    )
    .bind(regId)
    .first();

  if (!reg) throw new Error('REGISTRATION_NOT_FOUND');
  const r = reg as any;
  if (r.status !== 'CANCELLED') throw new Error('NOT_CANCELLED');

  const missionId = r.mission_id;
  const wasConfirmed = r.original_status === 'CONFIRMED';

  // Get current availability (count from BOTH tables)
  const counts = await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
       FROM registrations WHERE mission_id = ?`,
    )
    .bind(missionId)
    .first();
  const confirmedCount = (counts as any)?.confirmed || 0;

  const tempCounts = await db
    .prepare(
      `SELECT
         COUNT(CASE WHEN status = 'CONFIRMED' THEN 1 END) as confirmed
       FROM temporary_registrations WHERE mission_id = ?`,
    )
    .bind(missionId)
    .first();
  const tempConfirmedCount = (tempCounts as any)?.confirmed || 0;
  const totalConfirmed = confirmedCount + tempConfirmedCount;

  // Get mission capacity
  const mission = await db
    .prepare(`SELECT capacity FROM missions WHERE id = ?`)
    .bind(missionId)
    .first();
  const capacity = (mission as any)?.capacity || 0;

  let restoredStatus: string;
  let revokedPromotion: RestoreResult['revoked_promotion'] = null;

  if (wasConfirmed) {
    // Was CONFIRMED — try to restore to CONFIRMED
    if (totalConfirmed < capacity) {
      // Find the first available seat (1..capacity not occupied in EITHER table)
      const usedSeatsOfficial = await db
        .prepare(
          `SELECT seat_number FROM registrations
           WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL`,
        )
        .bind(missionId)
        .all();
      const usedSeatsTemp = await db
        .prepare(
          `SELECT seat_number FROM temporary_registrations
           WHERE mission_id = ? AND status = 'CONFIRMED' AND seat_number IS NOT NULL`,
        )
        .bind(missionId)
        .all();
      const usedSet = new Set([
        ...(usedSeatsOfficial.results || []).map((s: any) => s.seat_number),
        ...(usedSeatsTemp.results || []).map((s: any) => s.seat_number),
      ]);
      let newSeat = 1;
      while (usedSet.has(newSeat) && newSeat <= capacity) newSeat++;

      if (newSeat > capacity) {
        throw new Error('NO_AVAILABLE_SEAT');
      }

      await db
        .prepare(
          `UPDATE registrations
           SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL,
               restored_at = datetime('now')
           WHERE id = ?`,
        )
        .bind(newSeat, regId)
        .run();
      restoredStatus = 'CONFIRMED';
    } else {
      // No seat available → revoke the most recent promotion
      // Check registrations first, then temporary_registrations
      const mostRecentConfirmed = await db
        .prepare(
          `SELECT r.id, v.name, r.seat_number, 'OFFICIAL' as source
           FROM registrations r
           JOIN volunteers v ON v.id = r.volunteer_id
           WHERE r.mission_id = ? AND r.status = 'CONFIRMED'
           ORDER BY r.confirmed_at DESC
           LIMIT 1`,
        )
        .bind(missionId)
        .first();

      const mostRecentTempConfirmed = await db
        .prepare(
          `SELECT id, name, seat_number, 'TEMP' as source
           FROM temporary_registrations
           WHERE mission_id = ? AND status = 'CONFIRMED'
           ORDER BY confirmed_at DESC
           LIMIT 1`,
        )
        .bind(missionId)
        .first();

      // Pick the more recent one across both tables
      let rc: any = null;
      let rcSource = '';
      const officialTime = (mostRecentConfirmed as any)?.confirmed_at || '';
      const tempTime = (mostRecentTempConfirmed as any)?.confirmed_at || '';

      if (mostRecentConfirmed && (!mostRecentTempConfirmed || officialTime >= tempTime)) {
        rc = mostRecentConfirmed as any;
        rcSource = 'OFFICIAL';
      } else if (mostRecentTempConfirmed) {
        rc = mostRecentTempConfirmed as any;
        rcSource = 'TEMP';
      }

      if (rc) {
        if (rcSource === 'OFFICIAL') {
          // Demote official to WAITLIST
          const maxWaitlist = await db
            .prepare(
              `SELECT COALESCE(MAX(waitlist_position), 0) + 1 as next_pos
               FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
            )
            .bind(missionId)
            .first();
          const newWaitlistPos = (maxWaitlist as any)?.next_pos || 1;

          await db
            .prepare(
              `UPDATE registrations
               SET status = 'WAITLIST', seat_number = NULL,
                   waitlist_position = ?, confirmed_at = NULL
               WHERE id = ?`,
            )
            .bind(newWaitlistPos, rc.id)
            .run();

          // Restore the original as CONFIRMED with the freed seat
          await db
            .prepare(
              `UPDATE registrations
               SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL,
                   restored_at = datetime('now')
               WHERE id = ?`,
            )
            .bind(rc.seat_number, regId)
            .run();
        } else {
          // Demote temporary to WAITLIST
          const maxTempWaitlist = await db
            .prepare(
              `SELECT COALESCE(MAX(waitlist_position), 0) + 1 as next_pos
               FROM temporary_registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
            )
            .bind(missionId)
            .first();
          const newWaitlistPos = (maxTempWaitlist as any)?.next_pos || 1;

          await db
            .prepare(
              `UPDATE temporary_registrations
               SET status = 'WAITLIST', seat_number = NULL,
                   waitlist_position = ?, confirmed_at = NULL
               WHERE id = ?`,
            )
            .bind(newWaitlistPos, rc.id)
            .run();

          // Restore the original as CONFIRMED with the freed seat
          await db
            .prepare(
              `UPDATE registrations
               SET status = 'CONFIRMED', seat_number = ?, waitlist_position = NULL,
                   restored_at = datetime('now')
               WHERE id = ?`,
            )
            .bind(rc.seat_number, regId)
            .run();
        }

        restoredStatus = 'CONFIRMED';
        revokedPromotion = {
          registration_id: rc.id,
          name: rc.name,
          demoted_to: 'WAITLIST',
        };
      } else {
        // Fallback: no confirmed to revoke → restore as WAITLIST
        const maxWaitlist = await db
          .prepare(
            `SELECT COALESCE(MAX(waitlist_position), 0) + 1 as next_pos
             FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
          )
          .bind(missionId)
          .first();
        const newWaitlistPos = (maxWaitlist as any)?.next_pos || 1;

        await db
          .prepare(
            `UPDATE registrations
             SET status = 'WAITLIST', seat_number = NULL,
                 waitlist_position = ?, restored_at = datetime('now')
             WHERE id = ?`,
          )
          .bind(newWaitlistPos, regId)
          .run();
        restoredStatus = 'WAITLIST';
      }
    }
  } else {
    // Was WAITLIST → restore as WAITLIST with next position
    const maxWaitlist = await db
      .prepare(
        `SELECT COALESCE(MAX(waitlist_position), 0) + 1 as next_pos
         FROM registrations WHERE mission_id = ? AND status = 'WAITLIST'`,
      )
      .bind(missionId)
      .first();
    const newWaitlistPos = (maxWaitlist as any)?.next_pos || 1;

    await db
      .prepare(
        `UPDATE registrations
         SET status = 'WAITLIST', seat_number = NULL,
             waitlist_position = ?, restored_at = datetime('now')
         WHERE id = ?`,
      )
      .bind(newWaitlistPos, regId)
      .run();
    restoredStatus = 'WAITLIST';
  }

  // Audit log
  await logAudit(db, {
    actorId: adminId,
    actorType: 'admin',
    action: 'REGISTRATION_RESTORED',
    entityType: 'registration',
    entityId: regId,
    metadata: {
      mission_id: missionId,
      restored_status: restoredStatus,
      revoked_promotion: revokedPromotion?.registration_id || null,
    },
  });

  // Increment mission version for live change detection (Phase 6)
  await incrementMissionVersion(db, missionId);

  return {
    registration_id: regId,
    restored_status: restoredStatus,
    revoked_promotion: revokedPromotion,
  };
}
