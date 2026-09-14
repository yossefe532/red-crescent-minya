/**
 * Mission Version Utility — Efficient change detection for live polling.
 *
 * The missions table has a `version` column (INTEGER DEFAULT 0).
 * Every registration state change (create, cancel, restore, promote)
 * increments this version by 1.
 *
 * The frontend sends `?since_version=N` — if unchanged, the server
 * returns `{ changed: false, version: N }` and avoids sending the
 * full payload. This eliminates blind polling.
 */

/**
 * Increment the mission version counter.
 * Call this after any registration state change (create, cancel, restore, promote).
 *
 * @param db     D1 database binding
 * @param missionId  The mission ID to increment
 * @returns The new version number, or null if the mission was not found
 */
export async function incrementMissionVersion(
  db: D1Database,
  missionId: string,
): Promise<number | null> {
  const result = await db
    .prepare(
      `UPDATE missions SET version = version + 1 WHERE id = ? RETURNING version`
    )
    .bind(missionId)
    .first();

  return (result as any)?.version ?? null;
}

/**
 * Get the current mission version without incrementing.
 * Useful for checking if data has changed since last poll.
 *
 * @param db     D1 database binding
 * @param missionId  The mission ID
 * @returns The current version number, or null if not found
 */
export async function getMissionVersion(
  db: D1Database,
  missionId: string,
): Promise<number | null> {
  const result = await db
    .prepare(`SELECT version FROM missions WHERE id = ?`)
    .bind(missionId)
    .first();

  return (result as any)?.version ?? null;
}
