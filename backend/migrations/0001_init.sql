-- ============================================================
-- Migration 0001 — Initial Schema
-- Red Crescent Minya Smart Mission Registration System
-- ============================================================

-- ============================================================
-- TABLE: missions
-- ============================================================
CREATE TABLE IF NOT EXISTS missions (
    id              TEXT PRIMARY KEY,
    public_code     TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    description     TEXT,
    location        TEXT,
    start_at        TEXT NOT NULL,
    end_at          TEXT NOT NULL,
    capacity        INTEGER NOT NULL CHECK(capacity > 0),
    confirmation_phrase TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK(status IN ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED')),
    registration_open_at  TEXT,
    registration_close_at TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    created_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_public_code ON missions(public_code);

-- ============================================================
-- TABLE: volunteers
-- ============================================================
CREATE TABLE IF NOT EXISTS volunteers (
    id              TEXT PRIMARY KEY,
    member_id       TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_volunteers_member_id ON volunteers(member_id);

-- ============================================================
-- TABLE: registrations
-- ============================================================
CREATE TABLE IF NOT EXISTS registrations (
    id                      TEXT PRIMARY KEY,
    mission_id              TEXT NOT NULL REFERENCES missions(id),
    volunteer_id            TEXT NOT NULL REFERENCES volunteers(id),
    status                  TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK(status IN ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED')),
    seat_number             INTEGER,
    waitlist_position       INTEGER,
    registration_sequence   INTEGER NOT NULL,
    request_id              TEXT UNIQUE,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at            TEXT,
    cancelled_at            TEXT,
    
    UNIQUE(mission_id, volunteer_id)
);

CREATE INDEX IF NOT EXISTS idx_registrations_mission ON registrations(mission_id);
CREATE INDEX IF NOT EXISTS idx_registrations_volunteer ON registrations(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_registrations_status ON registrations(status);
CREATE INDEX IF NOT EXISTS idx_registrations_sequence ON registrations(mission_id, registration_sequence);
CREATE INDEX IF NOT EXISTS idx_registrations_request_id ON registrations(request_id);

-- ============================================================
-- TABLE: audio_confirmations
-- ============================================================
CREATE TABLE IF NOT EXISTS audio_confirmations (
    id              TEXT PRIMARY KEY,
    registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),
    phrase          TEXT NOT NULL,
    audio_key       TEXT NOT NULL,
    duration_ms     INTEGER NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT 'audio/webm',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audio_registration ON audio_confirmations(registration_id);

-- ============================================================
-- TABLE: admin_users
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_users (
    id              TEXT PRIMARY KEY,
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    display_name    TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- TABLE: audit_logs
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id              TEXT PRIMARY KEY,
    actor_id        TEXT,
    actor_type      TEXT NOT NULL DEFAULT 'admin'
                    CHECK(actor_type IN ('admin', 'system', 'volunteer')),
    action          TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    metadata        TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ============================================================
-- TABLE: registration_attempts
-- ============================================================
CREATE TABLE IF NOT EXISTS registration_attempts (
    id              TEXT PRIMARY KEY,
    mission_id      TEXT NOT NULL,
    volunteer_id    TEXT,
    member_id       TEXT,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK(status IN ('PENDING', 'COMPLETED', 'EXPIRED')),
    audio_key       TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_expires ON registration_attempts(expires_at);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON registration_attempts(status);

-- ============================================================
-- TABLE: admin_sessions (for persistent session storage)
-- ============================================================
CREATE TABLE IF NOT EXISTS admin_sessions (
    token         TEXT PRIMARY KEY,
    admin_id      TEXT NOT NULL REFERENCES admin_users(id),
    username      TEXT NOT NULL,
    expires_at    TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON admin_sessions(expires_at);

-- ============================================================
-- TABLE: settings (key-value store for bot config, e.g. notifications_enabled)
-- ============================================================
CREATE TABLE IF NOT EXISTS settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
