-- Phase 6: Add version column to missions for efficient change detection.
-- The frontend sends `?since_version=N` and the server returns either
-- { changed: false } or the full payload if version differs.
-- This eliminates blind polling and reduces D1 reads significantly.

ALTER TABLE missions ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
