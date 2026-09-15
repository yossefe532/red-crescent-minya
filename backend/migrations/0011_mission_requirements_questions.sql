-- ═══════════════════════════════════════════════════════
-- Migration 0011: Mission Requirements & Questions
-- Adds 3 new tables with FK cascades, indexes, ordering
-- DO NOT delete answers when registration status changes
-- ═══════════════════════════════════════════════════════

-- ─── Mission Requirements ────────────────────────────
CREATE TABLE IF NOT EXISTS mission_requirements (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  type        TEXT NOT NULL DEFAULT 'TEXT_REQUIREMENT',
  text        TEXT NOT NULL,
  requires_acceptance INTEGER NOT NULL DEFAULT 1,
  auto_verify INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mission_requirements_mission
  ON mission_requirements(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_requirements_active
  ON mission_requirements(mission_id, active);

-- ─── Mission Questions ───────────────────────────────
CREATE TABLE IF NOT EXISTS mission_questions (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  question_text  TEXT NOT NULL,
  question_type TEXT NOT NULL DEFAULT 'TEXT',
  required    INTEGER NOT NULL DEFAULT 0,
  options     TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mission_questions_mission
  ON mission_questions(mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_questions_active
  ON mission_questions(mission_id, active);

-- ─── Registration Answers ────────────────────────────
CREATE TABLE IF NOT EXISTS registration_answers (
  id           TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  question_id  TEXT NOT NULL REFERENCES mission_questions(id) ON DELETE CASCADE,
  answer_text  TEXT NOT NULL DEFAULT '',
  answered_at  TEXT NOT NULL DEFAULT (datetime('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_answers_reg_question
  ON registration_answers(registration_id, question_id);
CREATE INDEX IF NOT EXISTS idx_reg_answers_registration
  ON registration_answers(registration_id);
