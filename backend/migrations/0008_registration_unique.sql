-- 0008_registration_unique.sql
-- Phase 2: DB Idempotency — Registration uniqueness hardening
--
-- The UNIQUE(mission_id, volunteer_id) constraint already exists in 0001_init.sql.
-- This migration re-asserts it via a named index for environments where the
-- table was created before the constraint was added (e.g. early production DBs).
-- It is idempotent: fails safely if an equivalent index already exists.

-- Create the uniqueness index. If duplicate rows already exist (early prod DBs),
-- this CREATE will fail loudly — the correct action is to dedupe those rows
-- manually first, NOT to drop the index (that would silently re-open the hole).
CREATE UNIQUE INDEX IF NOT EXISTS idx_registrations_mission_volunteer
  ON registrations(mission_id, volunteer_id);