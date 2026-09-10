-- ============================================================
-- 0003: Store audio bytes directly in D1 (fallback when R2 unavailable)
-- ============================================================

ALTER TABLE audio_confirmations ADD COLUMN audio_data BLOB;