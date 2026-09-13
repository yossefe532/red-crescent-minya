-- notification_events table for outbox pattern
CREATE TABLE IF NOT EXISTS notification_events (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  registration_id TEXT NOT NULL,
  mission_id      TEXT NOT NULL,
  admin_chat_id   TEXT NOT NULL,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING',
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  processed_at    TEXT,
  last_error      TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_pending
  ON notification_events(status, next_attempt_at);
