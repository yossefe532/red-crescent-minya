-- ============================================================
-- Migration 0009: Live Registration — Ownership + Restore
-- Date: 2026-09-14
-- ============================================================
-- All changes are ADD COLUMN only — fully backward compatible.
-- nullable columns: old rows get NULL (existing logic ignores them).

-- ── Ownership: device/browser identification ──
ALTER TABLE registrations ADD COLUMN ownership_token TEXT;
ALTER TABLE temporary_registrations ADD COLUMN ownership_token TEXT;

-- ── Restore support ──
ALTER TABLE registrations ADD COLUMN original_status TEXT;
ALTER TABLE registrations ADD COLUMN restored_at TEXT;
ALTER TABLE registrations ADD COLUMN cancelled_by TEXT;

ALTER TABLE temporary_registrations ADD COLUMN original_status TEXT;
ALTER TABLE temporary_registrations ADD COLUMN restored_at TEXT;
ALTER TABLE temporary_registrations ADD COLUMN cancelled_by TEXT;

-- ── Idempotency key (double-submit prevention) ──
ALTER TABLE registrations ADD COLUMN idempotency_key TEXT;

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_reg_ownership ON registrations(ownership_token);
CREATE INDEX IF NOT EXISTS idx_reg_idempotency ON registrations(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_temp_reg_ownership ON temporary_registrations(ownership_token);
CREATE INDEX IF NOT EXISTS idx_reg_cancelled_by ON registrations(cancelled_by);
