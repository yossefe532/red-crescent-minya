-- Add waiting_list capacity and telegram_notifications toggle to missions table
-- Run this migration to support waiting list and real-time notifications

-- Add waiting_list column (default 0 = no waiting list)
ALTER TABLE missions ADD COLUMN waiting_list INTEGER NOT NULL DEFAULT 0;

-- Add telegram_notifications toggle (default 1 = enabled)
ALTER TABLE missions ADD COLUMN telegram_notifications INTEGER NOT NULL DEFAULT 1;

-- Create index for faster queries on status + capacity
CREATE INDEX IF NOT EXISTS idx_missions_status_capacity ON missions(status, capacity, waiting_list);

-- Verify columns added
-- SELECT waiting_list, telegram_notifications FROM missions LIMIT 5;