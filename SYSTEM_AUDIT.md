# SYSTEM AUDIT — Red Crescent Minya
**Date:** 2026-09-13 | **Mode:** READ-ONLY | **Status:** ACTIVE (production: red-crescent-minya.pages.dev)

## 1. Project Overview
Volunteer registration system for Red Crescent Minya. Cloudflare Workers/D1/Hono/TypeScript backend + React/Vite/TailwindCSS frontend + Grammy Telegram Bot.

## 2. Current Architecture
- Cloudflare Pages (frontend hosting)
- Cloudflare Workers (backend + Telegram webhook)
- Cloudflare D1 (SQLite-compatible database)
- Cloudflare R2 (audio storage)
- Grammy (TypeScript Telegram bot framework)
- Hono (TypeScript web framework)

## 3. Technology Stack
### Frontend
- Framework: React 18 + Vite + TypeScript
- State: TanStack Query (React Query) + useState
- Routing: react-router-dom v6
- UI: TailwindCSS (no component library)
- API: fetch() with credentials: 'include'

### Backend
- Framework: Hono (Cloudflare Workers)
- Language: TypeScript
- ORM: Raw SQL (D1 prepared statements — no ORM)
- Validation: Zod schemas (admin.schema.ts)
- Auth: Cookie + X-Auth-Token (admin sessions in D1)

### Database
- Engine: Cloudflare D1 (SQLite-compatible)
- Migrations: 5 SQL files in backend/migrations/
- Tables: missions, volunteers, registrations, audio_confirmations, admin_users, admin_sessions, audit_logs, quick_profiles, temporary_registrations, settings, telegram_sessions

### Telegram
- Library: Grammy (v2)
- Architecture: Webhook (not polling)
- Token: 8804029407:AAFQCZVx8A1i8w22niQyT-cCz7dJ0LJVJug (in memory/env)
- ADMIN_CHAT_IDS: comma-separated list from env

### Storage
- Voice recordings: R2 primary, D1 base64 blob fallback
- R2 bucket: red-crescent-minya-audio
- Key format: missions/{missionId}/registrations/{registrationId}.webm

## 4. Database Models
### missions
- id, public_code (MNY-XXX, unique), title, description, location, start_at, end_at, capacity, waiting_list, telegram_notifications, status (DRAFT|OPEN|CLOSED|CANCELLED|COMPLETED), confirmation_phrase, registration_open_at, registration_close_at, created_at, updated_at, created_by
- Indexes: idx_missions_status, idx_missions_public_code

### volunteers
- id, member_id (unique), name, phone, created_at, updated_at
- Index: idx_volunteers_member_id

### registrations
- id, mission_id (FK), volunteer_id (FK), status (PENDING|CONFIRMED|WAITLIST|CANCELLED), seat_number, waitlist_position, registration_sequence, request_id (unique), created_at, confirmed_at, cancelled_at
- Unique: UNIQUE(mission_id, volunteer_id)
- Indexes: idx_registrations_mission, idx_registrations_volunteer, idx_registrations_status, idx_registrations_sequence

### audio_confirmations
- id, registration_id, phrase, audio_key, duration_ms, mime_type, audio_data (base64 D1 fallback), created_at

### admin_users / admin_sessions / audit_logs / settings / quick_profiles / temporary_registrations / telegram_sessions

## 5. API Endpoints
### Public (no auth)
- GET /api/missions/:publicCode
- GET /api/missions/:publicCode/registrations-live
- GET /api/missions/:publicCode/status
- GET /api/volunteers/by-member-id/:memberId
- POST /api/register (multipart/form-data or JSON+base64)
- GET /api/register/status/:registrationId

### Admin (auth required)
- POST /api/admin/login
- POST /api/admin/logout
- POST /api/admin/missions (create)
- GET /api/admin/missions (list, paginated)
- GET /api/admin/missions/:id (detail + availability)
- PATCH /api/admin/missions/:id (update)
- POST /api/admin/missions/:id/toggle-registration
- PATCH /api/admin/missions/:id/details
- POST /api/admin/missions/:id/close
- DELETE /api/admin/missions/:id
- GET /api/admin/missions/:id/registrations
- POST /api/admin/missions/:id/cancel/:regId
- GET /api/admin/missions/:id/export (CSV)
- GET /api/admin/registrations/:regId/audio

### Telegram Webhook
- POST /telegram (main webhook)
- POST /telegram/setWebhook (manual)

## 6. Task Lifecycle (Mission = Task)
- Create: Admin Panel or Telegram wizard
- Edit: Admin Panel (PATCH /missions/:id/details) or Telegram edit wizard
- Delete: Admin Panel or Telegram wizard
- Open: Close registration (set registration_open_at, clear registration_close_at, status=OPEN)
- Close: Set registration_close_at=now, status=CLOSED
- Auto-close: When capacity full AND waitlist full → status=CLOSED + registration_close_at=now
- Reopen: NO reopen action exists — once CLOSED, stays CLOSED
- Statuses: DRAFT, OPEN, CLOSED, CANCELLED, COMPLETED

## 7. Volunteer Lifecycle
- REGISTERED (CONFIRMED): confirmed seat
- WAITLIST: waiting for a seat
- CANCELLED: admin cancelled
- PENDING: exists in DB but not used in practice
- No CONFIRMED→CANCELLED by volunteer (only admin cancels)

## 8. Waiting List Lifecycle
- Capacity check: if available>0 → CONFIRMED; else if waitlistAvailable>0 → WAITLIST; else REJECTED + auto-close mission
- Waitlist position: waitlistCount+1
- Promote on cancel: first WAITLIST promoted to CONFIRMED

## 9. Recording Lifecycle
- Recorded in browser (MediaRecorder, webm)
- Sent as multipart or base64 JSON to /api/register
- Stored in R2 (primary) with key missions/{missionId}/registrations/{regId}.webm
- D1 base64 fallback if R2 fails
- Audio confirmation record in audio_confirmations table
- Retrieved via GET /api/admin/registrations/:regId/audio
