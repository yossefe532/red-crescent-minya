# DATABASE — Red Crescent Minya Smart Mission Registration System

**Date:** 2026-09-03  
**Database:** Cloudflare D1 (SQLite)  
**Version:** MVP v1.0

---

## 1. Schema Overview

```sql
-- ============================================================
-- TABLE: missions
-- ============================================================
CREATE TABLE missions (
    id              TEXT PRIMARY KEY,           -- e.g., 'MNY-482'
    public_code     TEXT NOT NULL UNIQUE,       -- e.g., 'MNY-482' (same as id for MVP)
    title           TEXT NOT NULL,
    description     TEXT,
    location        TEXT,
    start_at        TEXT NOT NULL,              -- ISO 8601
    end_at          TEXT NOT NULL,              -- ISO 8601
    capacity        INTEGER NOT NULL CHECK(capacity > 0),
    confirmation_phrase TEXT NOT NULL,          -- e.g., 'I confirm my participation in mission MNY-482.'
    status          TEXT NOT NULL DEFAULT 'DRAFT'
                    CHECK(status IN ('DRAFT', 'OPEN', 'CLOSED', 'CANCELLED', 'COMPLETED')),
    registration_open_at  TEXT,                 -- ISO 8601, nullable
    registration_close_at TEXT,                 -- ISO 8601, nullable
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    created_by      TEXT                        -- admin_id
);

CREATE INDEX idx_missions_status ON missions(status);
CREATE INDEX idx_missions_public_code ON missions(public_code);

-- ============================================================
-- TABLE: volunteers
-- ============================================================
-- NOTE: This is NOT a login account. It's a lightweight identity record.
-- ============================================================
CREATE TABLE volunteers (
    id              TEXT PRIMARY KEY,           -- UUID
    member_id       TEXT NOT NULL UNIQUE,       -- e.g., '102583'
    name            TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_volunteers_member_id ON volunteers(member_id);

-- ============================================================
-- TABLE: registrations
-- ============================================================
CREATE TABLE registrations (
    id                      TEXT PRIMARY KEY,   -- UUID
    mission_id              TEXT NOT NULL REFERENCES missions(id),
    volunteer_id            TEXT NOT NULL REFERENCES volunteers(id),
    status                  TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK(status IN ('PENDING', 'CONFIRMED', 'WAITLIST', 'CANCELLED')),
    seat_number             INTEGER,            -- NULL for waitlist
    waitlist_position       INTEGER,            -- NULL for confirmed
    registration_sequence   INTEGER NOT NULL,   -- global sequence per mission
    request_id              TEXT UNIQUE,        -- idempotency key
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at            TEXT,
    cancelled_at            TEXT,
    
    -- CRITICAL: One member can only register once per mission
    UNIQUE(mission_id, volunteer_id)
);

CREATE INDEX idx_registrations_mission ON registrations(mission_id);
CREATE INDEX idx_registrations_volunteer ON registrations(volunteer_id);
CREATE INDEX idx_registrations_status ON registrations(status);
CREATE INDEX idx_registrations_sequence ON registrations(mission_id, registration_sequence);
CREATE INDEX idx_registrations_request_id ON registrations(request_id);

-- ============================================================
-- TABLE: audio_confirmations
-- ============================================================
CREATE TABLE audio_confirmations (
    id              TEXT PRIMARY KEY,           -- UUID
    registration_id TEXT NOT NULL UNIQUE REFERENCES registrations(id),
    phrase          TEXT NOT NULL,              -- the exact phrase displayed
    audio_key       TEXT NOT NULL,              -- R2 object key
    duration_ms     INTEGER NOT NULL,
    mime_type       TEXT NOT NULL DEFAULT 'audio/webm',
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audio_registration ON audio_confirmations(registration_id);

-- ============================================================
-- TABLE: admin_users
-- ============================================================
CREATE TABLE admin_users (
    id              TEXT PRIMARY KEY,           -- UUID
    username        TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,              -- bcrypt hash
    display_name    TEXT,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- TABLE: audit_logs
-- ============================================================
CREATE TABLE audit_logs (
    id              TEXT PRIMARY KEY,           -- UUID
    actor_id        TEXT,                       -- admin_id or 'system'
    actor_type      TEXT NOT NULL DEFAULT 'admin'
                    CHECK(actor_type IN ('admin', 'system', 'volunteer')),
    action          TEXT NOT NULL,              -- e.g., 'MISSION_CREATED', 'REGISTRATION_CANCELLED'
    entity_type     TEXT NOT NULL,              -- 'mission', 'registration', 'volunteer'
    entity_id       TEXT NOT NULL,
    metadata        TEXT,                       -- JSON string
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- ============================================================
-- TABLE: registration_attempts (temporary, for abandoned cleanup)
-- ============================================================
CREATE TABLE registration_attempts (
    id              TEXT PRIMARY KEY,           -- UUID (attempt_id)
    mission_id      TEXT NOT NULL,
    volunteer_id    TEXT,
    member_id       TEXT,
    name            TEXT,
    status          TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK(status IN ('PENDING', 'COMPLETED', 'EXPIRED')),
    audio_key       TEXT,                       -- if audio uploaded but not submitted
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at      TEXT NOT NULL               -- datetime('now', '+10 minutes')
);

CREATE INDEX idx_attempts_expires ON registration_attempts(expires_at);
CREATE INDEX idx_attempts_status ON registration_attempts(status);
```

---

## 2. Entity Relationship Diagram

```
┌──────────────┐       ┌──────────────────┐       ┌─────────────────┐
│   missions   │       │  registrations   │       │   volunteers    │
├──────────────┤       ├──────────────────┤       ├─────────────────┤
│ id (PK)      │◄──────│ mission_id (FK)  │       │ id (PK)         │
│ public_code  │       │ volunteer_id(FK) │──────▶│ member_id (UQ)  │
│ title        │       │ status           │       │ name            │
│ description  │       │ seat_number      │       │ created_at      │
│ location     │       │ waitlist_pos     │       │ updated_at      │
│ start_at     │       │ reg_sequence     │       └─────────────────┘
│ end_at       │       │ request_id (UQ)  │
│ capacity     │       │ created_at       │
│ phrase       │       │ confirmed_at     │       ┌─────────────────┐
│ status       │       │ cancelled_at     │       │audio_confirmations
│ created_at   │       └──────────────────┘       ├─────────────────┤
│ updated_at   │              │                   │ id (PK)         │
│ created_by   │              │                   │ registration_id │
└──────────────┘              │                   │ phrase          │
                              │                   │ audio_key       │
                              │                   │ duration_ms     │
                              │                   │ mime_type       │
                              │                   │ created_at      │
                              │                   └─────────────────┘
                              │
                      ┌───────┴───────────┐
                      │ registration_     │
                      │ attempts          │
                      ├───────────────────┤
                      │ id (PK)           │
                      │ mission_id        │
                      │ volunteer_id      │
                      │ member_id         │
                      │ name              │
                      │ status            │
                      │ audio_key         │
                      │ created_at        │
                      │ expires_at        │
                      └───────────────────┘

┌──────────────┐       ┌──────────────────┐
│ admin_users  │       │   audit_logs     │
├──────────────┤       ├──────────────────┤
│ id (PK)      │◄──────│ actor_id (FK)    │
│ username(UQ) │       │ actor_type       │
│ password_hash│       │ action           │
│ display_name │       │ entity_type      │
│ is_active    │       │ entity_id        │
│ created_at   │       │ metadata (JSON)  │
│ updated_at   │       │ created_at       │
└──────────────┘       └──────────────────┘
```

---

## 3. Critical Constraints

| Constraint | Table | Purpose |
|------------|-------|---------|
| `UNIQUE(mission_id, volunteer_id)` | registrations | Prevents duplicate registration |
| `UNIQUE(member_id)` | volunteers | One identity per member ID |
| `UNIQUE(request_id)` | registrations | Idempotency — prevents double-submit |
| `UNIQUE(registration_id)` | audio_confirmations | One audio per registration |
| `CHECK(capacity > 0)` | missions | Valid capacity |
| `CHECK(status IN (...))` | multiple | Valid state values |

---

## 4. Key Queries

### 4.1 Atomic Seat Allocation (Most Critical)

```sql
-- This runs inside a transaction
-- Step 1: Count current confirmed
SELECT COUNT(*) as confirmed_count 
FROM registrations 
WHERE mission_id = ? AND status = 'CONFIRMED';

-- Step 2: If confirmed_count < capacity → INSERT CONFIRMED
-- Else → INSERT WAITLIST

-- Step 3: Get next sequence number
SELECT COALESCE(MAX(registration_sequence), 0) + 1 as next_seq
FROM registrations 
WHERE mission_id = ?;
```

### 4.2 Waitlist Promotion (After Cancellation)

```sql
-- Step 1: Cancel the registration
UPDATE registrations 
SET status = 'CANCELLED', cancelled_at = datetime('now')
WHERE id = ?;

-- Step 2: Promote first waitlisted
UPDATE registrations 
SET status = 'CONFIRMED', 
    seat_number = ?,
    waitlist_position = NULL,
    confirmed_at = datetime('now')
WHERE id = (
    SELECT id FROM registrations 
    WHERE mission_id = ? AND status = 'WAITLIST'
    ORDER BY waitlist_position ASC 
    LIMIT 1
);

-- Step 3: Re-number remaining waitlist
UPDATE registrations 
SET waitlist_position = waitlist_position - 1
WHERE mission_id = ? AND status = 'WAITLIST';
```

### 4.3 Member Lookup

```sql
SELECT name FROM volunteers WHERE member_id = ?;
```

### 4.4 Mission Availability (for polling)

```sql
SELECT 
    m.capacity,
    COUNT(CASE WHEN r.status = 'CONFIRMED' THEN 1 END) as confirmed,
    COUNT(CASE WHEN r.status = 'WAITLIST' THEN 1 END) as waitlist,
    m.capacity - COUNT(CASE WHEN r.status = 'CONFIRMED' THEN 1 END) as available
FROM missions m
LEFT JOIN registrations r ON r.mission_id = m.id
WHERE m.public_code = ?
GROUP BY m.id;
```

---

## 5. Indexes Strategy

| Index | Purpose |
|-------|---------|
| `idx_missions_public_code` | Fast public page loads |
| `idx_missions_status` | Admin dashboard filtering |
| `idx_volunteers_member_id` | Member lookup (hot path) |
| `idx_registrations_mission` | Participant list |
| `idx_registrations_status` | Count queries |
| `idx_registrations_sequence` | Ordered participant display |
| `idx_registrations_request_id` | Idempotency check |
| `idx_attempts_expires` | Cleanup job |

---

## 6. Data Retention

| Data | Retention | Action |
|------|-----------|--------|
| Audio files (R2) | 90 days (configurable) | Auto-delete after expiry |
| Registration records | Permanent | Keep metadata |
| Audit logs | Permanent | Keep for accountability |
| Abandoned attempts | 10 minutes | Auto-cleanup |

---

## 7. Migration Strategy

Migrations are SQL files applied via Wrangler:

```bash
wrangler d1 execute red-crescent-minya --file=./migrations/0001_init.sql
```

For production:
```bash
wrangler d1 execute red-crescent-minya --file=./migrations/0001_init.sql --remote
```

---

**Next Step:** Phase 1 — Foundation (apply schema, setup project)
