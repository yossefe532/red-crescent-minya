# MVP SCOPE — Red Crescent Minya Smart Mission Registration System

**Date:** 2026-09-03  
**Version:** MVP v1.0

---

## 1. MVP Scope Summary

The MVP is a **lightweight, mobile-first web system** that replaces WhatsApp-based volunteer mission registration for the Egyptian Red Crescent — Minya Branch.

**Core promise:** "WhatsApp mission registration, but fixed."

---

## 2. What IS in Scope

### 2.1 Admin Features

| Feature | Description |
|---------|-------------|
| Admin login | Secure cookie-based authentication |
| Create mission | Title, description, location, dates, capacity |
| Edit mission | Update any field |
| Open/Close registration | Toggle registration availability |
| Cancel mission | Mark as cancelled |
| View registrations | Confirmed + waitlist, searchable |
| Audio playback | Listen to volunteer confirmations |
| Export | CSV download of participant list |
| Cancel registration | Manual removal with auto-promotion |
| Audit log | Track all admin actions |

### 2.2 Volunteer Features

| Feature | Description |
|---------|-------------|
| Public mission page | View mission details + available slots |
| Member ID lookup | Auto-fill name from previous registrations |
| Manual name entry | For new members |
| Voice recording | Mandatory confirmation phrase |
| Real-time availability | Polling-based slot counter |
| Registration result | Immediate confirmed/waitlist status |
| Waitlist | Automatic placement when full |

### 2.3 System Features

| Feature | Description |
|---------|-------------|
| Atomic registration | Concurrency-safe seat allocation |
| Duplicate prevention | Unique constraint on (mission_id, volunteer_id) |
| Idempotency | request_id prevents double-submit |
| Waitlist promotion | Auto-promote on cancellation |
| Audio storage | Private R2 with presigned URLs |
| Rate limiting | Per-IP limits on public endpoints |
| Audit trail | All admin actions logged |

---

## 3. What is NOT in Scope

### 3.1 Explicitly Excluded

| Feature | Reason |
|---------|--------|
| Volunteer accounts | No login, no passwords |
| QR attendance | Future phase |
| WhatsApp API | Admin copies message manually |
| SMS notifications | Future phase |
| Email notifications | Future phase |
| Gamification | Not needed for MVP |
| Volunteer points/ratings | Future phase |
| Certificates | Future phase |
| Mobile application | Web-only for MVP |
| Biometric voice recognition | Audio is confirmation, not authentication |
| Speech-to-text | Not needed |
| Face verification | Not needed |
| GPS tracking | Not needed |
| Payment systems | Not needed |
| Multi-branch | Single branch (Minya) |
| Advanced CRM | Future phase |
| AI features | Not needed |
| WebSockets | Polling is sufficient |
| Microservices | Monolith Worker is fine |

---

## 4. User Stories

### Admin

| ID | Story | Acceptance |
|----|-------|------------|
| A1 | As an admin, I want to create a mission with title, dates, and capacity | Mission is created with unique public code |
| A2 | As an admin, I want to open/close registration | Status changes immediately |
| A3 | As an admin, I want to see all registrations for a mission | List shows confirmed + waitlist with details |
| A4 | As an admin, I want to listen to a volunteer's audio confirmation | Audio plays through authenticated interface |
| A5 | As an admin, I want to cancel a registration | Registration cancelled, waitlist promoted |
| A6 | As an admin, I want to export registrations to CSV | CSV downloads with all fields |
| A7 | As an admin, I want to copy a WhatsApp message for the mission | Pre-formatted message is generated |

### Volunteer

| ID | Story | Acceptance |
|----|-------|------------|
| V1 | As a volunteer, I want to open a mission link from WhatsApp | Mission page loads with details |
| V2 | As a volunteer, I want to enter my member ID and see my name | Name auto-fills if previously registered |
| V3 | As a volunteer, I want to record a confirmation phrase | Recording starts/stops with playback |
| V4 | As a volunteer, I want to submit and get immediate result | Confirmed or waitlist status shown |
| V5 | As a volunteer, I want to see available slots | Counter shows real-time availability |
| V6 | As a volunteer, I don't want to create an account | No login required |

---

## 5. Success Criteria (Acceptance Tests)

| # | Test | Expected Result |
|---|------|-----------------|
| 1 | 10 capacity, 50 concurrent registrations | Exactly 10 CONFIRMED, 40 WAITLIST |
| 2 | Same Member ID submits twice | Exactly 1 registration |
| 3 | User double-clicks submit | Exactly 1 registration |
| 4 | Mission fills while user is recording | User gets waitlist, not false confirmed |
| 5 | Two users submit at nearly same time | Deterministic sequence in database |
| 6 | Known Member ID entered | Name auto-populated |
| 7 | Unknown Member ID entered | Manual name entry allowed |
| 8 | No audio recorded | Registration rejected |
| 9 | Microphone permission denied | Registration cannot complete |
| 10 | Admin listens to recording | Audio plays through authenticated interface |
| 11 | Normal volunteer never creates account | ✅ |
| 12 | Normal volunteer never enters password | ✅ |
| 13 | Volunteer completes process on mobile browser | ✅ |
| 14 | Cancelled confirmed registration promotes first waitlist | Confirmed count stays at capacity |

---

## 6. Development Phases

| Phase | Name | Deliverable |
|-------|------|-------------|
| 0 | Audit & Planning | ✅ This document |
| 1 | Foundation | Project structure, Wrangler, D1 schema, health endpoint |
| 2 | Missions | Admin auth, mission CRUD, public mission page |
| 3 | Volunteer Lookup | Member ID lookup, name auto-fill |
| 4 | Registration Engine | Atomic seat allocation, waitlist, concurrency tests |
| 5 | Audio Confirmation | MediaRecorder, R2 upload, admin playback |
| 6 | Admin Participants | Participant list, search, cancel, audit log |
| 7 | Export | CSV export |
| 8 | UI/Polish | Mobile optimization, loading states, accessibility |

---

## 7. Technical Constraints

| Constraint | Value |
|------------|-------|
| Max recording duration | 10 seconds |
| Min recording duration | 1.5 seconds |
| Audio format | WebM/Opus |
| Max audio file size | ~50KB (10s WebM/Opus) |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| Backend | Cloudflare Workers |
| Frontend | React + Vite |
| Target load time | < 2s on 4G |
| Target API response | < 200ms |

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| D1 write concurrency | Seat over-allocation | Unique constraints + atomic transactions |
| Audio upload failure | Lost confirmation | Two-stage: prepare → upload → submit |
| Abandoned attempts | Wasted storage | Auto-expire after 10 minutes |
| Browser compatibility | Recording fails | Feature detection + fallback message |
| Rate limit abuse | Spam registrations | Per-IP limits + Turnstile (optional) |

---

## 9. Definition of Done

MVP is complete when:

- [ ] All 14 acceptance tests pass
- [ ] Concurrency test: 100 concurrent registrations → exactly 10 confirmed
- [ ] Mobile registration flow works on Android Chrome + iPhone Safari
- [ ] Admin can create mission, view registrations, listen to audio, export CSV
- [ ] No volunteer account creation required
- [ ] All audio is private (presigned URLs only)
- [ ] Audit log captures all admin actions
- [ ] Code is deployed to Cloudflare (Pages + Workers + D1 + R2)

---

**Next Step:** Phase 1 — Foundation
