-- ============================================================
-- Migration 0002: Add phone number + quick registration
-- Date: 2026-09-06
-- ============================================================

-- Add phone column to volunteers table (mandatory for all new registrations)
ALTER TABLE volunteers ADD COLUMN phone TEXT;

-- Create index on phone for quick lookup
CREATE INDEX IF NOT EXISTS idx_volunteers_phone ON volunteers(phone);

-- ============================================================
-- TABLE: quick_profiles
-- Stores volunteer quick-access profiles for faster future registration
-- ============================================================
CREATE TABLE IF NOT EXISTS quick_profiles (
    id              TEXT PRIMARY KEY,
    volunteer_id    TEXT NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
    member_id       TEXT NOT NULL,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_quick_profiles_volunteer_id ON quick_profiles(volunteer_id);
CREATE INDEX IF NOT EXISTS idx_quick_profiles_member_id ON quick_profiles(member_id);
CREATE INDEX IF NOT EXISTS idx_quick_profiles_phone ON quick_profiles(phone);

-- ============================================================
-- TABLE: temporary_registrations
-- For volunteers without member_id (pending official ID)
-- ============================================================
CREATE TABLE IF NOT EXISTS temporary_registrations (
    id              TEXT PRIMARY KEY,
    mission_id      TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    phone           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK(status IN ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED')),
    seat_number     INTEGER,
    waitlist_position INTEGER,
    registration_sequence INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at    TEXT,
    cancelled_at    TEXT,
    UNIQUE(mission_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_temp_registrations_mission_id ON temporary_registrations(mission_id);
CREATE INDEX IF NOT EXISTS idx_temp_registrations_phone ON temporary_registrations(phone);
CREATE INDEX IF NOT EXISTS idx_temp_registrations_status ON temporary_registrations(status);
