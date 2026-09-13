-- Migration 0006 — Reopen support + REJECTED status
-- NOTE: REJECTED is already in 0001_init.sql CHECK constraints.
-- D1/SQLite cannot ALTER TABLE to add CHECK constraints.
-- The only actionable item is the index for reopen queries.
-- Previous version used PostgreSQL DO $$ syntax which fails on D1.

-- Ensure missions table has registration_close_at index for reopen queries
CREATE INDEX IF NOT EXISTS idx_missions_reopen ON missions(status, registration_close_at);
