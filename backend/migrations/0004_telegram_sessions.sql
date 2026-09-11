-- Telegram bot conversation wizard state (per chat)
CREATE TABLE IF NOT EXISTS telegram_sessions (
  chat_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'idle',      -- idle | create_mission | cancel_volunteer | ...
  data TEXT NOT NULL DEFAULT '{}',         -- JSON blob of collected wizard data
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Volunteer info is available via the volunteers table (name, member_id, phone)