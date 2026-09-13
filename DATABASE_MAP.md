# DATABASE MAP
**Date:** 2026-09-13

## Tables
| Table | Purpose | Key Fields |
|-------|---------|------------|
| missions | Mission/task definition | id, public_code, title, capacity, waiting_list, status, registration_open_at, registration_close_at |
| volunteers | Volunteer profile | id, member_id (unique), name, phone |
| registrations | Volunteer → Mission enrollment | id, mission_id, volunteer_id, status, seat_number, waitlist_position, registration_sequence, request_id |
| audio_confirmations | Voice recording metadata | id, registration_id, audio_key, audio_data (base64 D1 fallback), mime_type |
| admin_users | Admin accounts | id, username, password_hash, display_name, is_active |
| admin_sessions | Auth sessions | token, admin_id, expires_at |
| audit_logs | Audit trail | actor_id, action, entity_type, entity_id, metadata |
| settings | Key-value settings | key, value |
| quick_profiles | Fast registration profiles | volunteer_id, member_id, name, phone |
| temporary_registrations | Provisional registrations | mission_id, name, phone, status |
| telegram_sessions | Bot wizard state | chat_id, state, data JSON |

## Critical Relationships
- registrations.mission_id → missions.id
- registrations.volunteer_id → volunteers.id
- audio_confirmations.registration_id → registrations.id
- quick_profiles.volunteer_id → volunteers.id
- temporary_registrations.mission_id → missions.id
- admin_sessions.admin_id → admin_users.id
