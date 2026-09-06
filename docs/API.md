# API — Red Crescent Minya Smart Mission Registration System

**Date:** 2026-09-03  
**Version:** MVP v1.0  
**Base URL:** `https://api.red-crescent-minya.com` (production) / `http://localhost:8787` (dev)

---

## 1. API Design Principles

- RESTful conventions
- JSON request/response bodies
- Standard HTTP status codes
- Zod validation on all inputs
- Rate limiting on public endpoints
- Idempotent registration submission

---

## 2. Response Format

### Success
```json
{
  "success": true,
  "data": { ... }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable message",
    "details": [ ... ]  // optional
  }
}
```

---

## 3. Public Endpoints

### 3.1 Get Mission by Public Code

```
GET /api/missions/:publicCode
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "MNY-482",
    "title": "Prosthetic Limbs Campaign",
    "description": "In cooperation with Ministry of Social Solidarity",
    "location": "Minya General Hospital",
    "start_at": "2026-09-16T08:00:00Z",
    "end_at": "2026-09-17T18:00:00Z",
    "capacity": 10,
    "confirmed_count": 7,
    "available_count": 3,
    "status": "OPEN",
    "confirmation_phrase": "I confirm my participation in mission MNY-482."
  }
}
```

**Response 404:**
```json
{
  "success": false,
  "error": {
    "code": "MISSION_NOT_FOUND",
    "message": "Mission not found."
  }
}
```

---

### 3.2 Lookup Volunteer by Member ID

```
GET /api/public/volunteers/by-member-id/:memberId
```

**Response 200 (found):**
```json
{
  "success": true,
  "data": {
    "found": true,
    "name": "Youssef Ayman"
  }
}
```

**Response 200 (not found):**
```json
{
  "success": true,
  "data": {
    "found": false
  }
}
```

**Rate Limit:** 30 requests/minute per IP

---

### 3.3 Prepare Registration Attempt

```
POST /api/registration/prepare
```

**Request:**
```json
{
  "mission_id": "MNY-482",
  "member_id": "102583",
  "name": "Youssef Ayman"  // optional if member exists
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "attempt_id": "att_abc123",
    "mission_id": "MNY-482",
    "volunteer_id": "vol_xyz789",
    "confirmation_phrase": "I confirm my participation in mission MNY-482.",
    "presigned_audio_url": "https://r2.cloudflarestorage.com/...",
    "audio_key": "missions/MNY-482/attempts/att_abc123.webm",
    "expires_at": "2026-09-03T18:10:00Z"
  }
}
```

**Response 409 (already registered):**
```json
{
  "success": false,
  "error": {
    "code": "ALREADY_REGISTERED",
    "message": "You are already registered for this mission."
  }
}
```

**Response 400 (mission closed):**
```json
{
  "success": false,
  "error": {
    "code": "MISSION_CLOSED",
    "message": "Registration for this mission is closed."
  }
}
```

---

### 3.4 Upload Audio (Direct to R2)

```
PUT {presigned_audio_url}
Content-Type: audio/webm

<binary audio data>
```

**Response:** 200 (from R2)

---

### 3.5 Submit Registration (Final)

```
POST /api/registration/submit
```

**Request:**
```json
{
  "attempt_id": "att_abc123",
  "request_id": "req_unique_123"  // idempotency key
}
```

**Response 200 (confirmed):**
```json
{
  "success": true,
  "data": {
    "registration_id": "REG-000482",
    "status": "CONFIRMED",
    "seat_number": 7,
    "registration_sequence": 7,
    "message": "Registration confirmed. Your position: #7"
  }
}
```

**Response 200 (waitlist):**
```json
{
  "success": true,
  "data": {
    "registration_id": "REG-000483",
    "status": "WAITLIST",
    "waitlist_position": 3,
    "message": "All confirmed places are currently full. You have been added to the waiting list at position #3."
  }
}
```

**Response 409 (duplicate request):**
```json
{
  "success": true,
  "data": {
    "registration_id": "REG-000482",
    "status": "CONFIRMED",
    "seat_number": 7,
    "message": "Registration confirmed. Your position: #7"
  }
}
```

---

### 3.6 Get Registration Result

```
GET /api/registration/:id
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "REG-000482",
    "mission_id": "MNY-482",
    "mission_title": "Prosthetic Limbs Campaign",
    "volunteer_name": "Youssef Ayman",
    "member_id": "102583",
    "status": "CONFIRMED",
    "seat_number": 7,
    "registration_sequence": 7,
    "created_at": "2026-09-03T17:30:00Z"
  }
}
```

---

## 4. Admin Endpoints

All admin endpoints require authentication (HttpOnly cookie).

### 4.1 Admin Login

```
POST /api/admin/login
```

**Request:**
```json
{
  "username": "admin",
  "password": "securepassword"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "admin_id": "adm_001",
    "username": "admin",
    "display_name": "System Admin"
  }
}
```

**Response 401:**
```json
{
  "success": false,
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid username or password."
  }
}
```

---

### 4.2 Admin Logout

```
POST /api/admin/logout
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "message": "Logged out successfully."
  }
}
```

---

### 4.3 Create Mission

```
POST /api/admin/missions
```

**Request:**
```json
{
  "title": "Prosthetic Limbs Campaign",
  "description": "In cooperation with Ministry of Social Solidarity",
  "location": "Minya General Hospital",
  "start_at": "2026-09-16T08:00:00Z",
  "end_at": "2026-09-17T18:00:00Z",
  "capacity": 10,
  "registration_open_at": "2026-09-03T17:00:00Z",
  "registration_close_at": "2026-09-15T23:59:59Z"
}
```

**Response 201:**
```json
{
  "success": true,
  "data": {
    "id": "MNY-482",
    "public_code": "MNY-482",
    "title": "Prosthetic Limbs Campaign",
    "confirmation_phrase": "I confirm my participation in mission MNY-482.",
    "public_url": "https://red-crescent-minya.com/m/MNY-482",
    "whatsapp_message": "صباح الخير متطوعينا الكرام\n\nعندنا قافلة..."
  }
}
```

---

### 4.4 List Missions

```
GET /api/admin/missions?status=OPEN&page=1&limit=20
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "missions": [
      {
        "id": "MNY-482",
        "title": "Prosthetic Limbs Campaign",
        "capacity": 10,
        "confirmed_count": 10,
        "waitlist_count": 4,
        "status": "OPEN",
        "created_at": "2026-09-03T17:00:00Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 20
  }
}
```

---

### 4.5 Get Mission Details

```
GET /api/admin/missions/:id
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "MNY-482",
    "title": "Prosthetic Limbs Campaign",
    "description": "...",
    "location": "Minya General Hospital",
    "start_at": "2026-09-16T08:00:00Z",
    "end_at": "2026-09-17T18:00:00Z",
    "capacity": 10,
    "confirmation_phrase": "I confirm my participation in mission MNY-482.",
    "status": "OPEN",
    "registration_open_at": "2026-09-03T17:00:00Z",
    "registration_close_at": "2026-09-15T23:59:59Z",
    "confirmed_count": 10,
    "waitlist_count": 4,
    "available_count": 0,
    "created_at": "2026-09-03T17:00:00Z",
    "updated_at": "2026-09-03T17:00:00Z"
  }
}
```

---

### 4.6 Update Mission

```
PATCH /api/admin/missions/:id
```

**Request:**
```json
{
  "title": "Updated Title",
  "capacity": 15,
  "status": "CLOSED"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "MNY-482",
    "title": "Updated Title",
    "capacity": 15,
    "status": "CLOSED"
  }
}
```

---

### 4.7 Get Mission Registrations

```
GET /api/admin/missions/:id/registrations?status=CONFIRMED&search=يوسف
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "registrations": [
      {
        "id": "REG-000482",
        "volunteer_name": "Youssef Ayman",
        "member_id": "102583",
        "status": "CONFIRMED",
        "seat_number": 7,
        "waitlist_position": null,
        "registration_sequence": 7,
        "created_at": "2026-09-03T17:30:00Z",
        "has_audio": true
      }
    ],
    "total": 10,
    "confirmed": 10,
    "waitlist": 4
  }
}
```

---

### 4.8 Cancel Registration

```
POST /api/admin/registrations/:id/cancel
```

**Request:**
```json
{
  "reason": "Volunteer requested cancellation"
}
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "REG-000482",
    "status": "CANCELLED",
    "promoted_registration": {
      "id": "REG-000490",
      "volunteer_name": "Ahmed Ali",
      "new_status": "CONFIRMED",
      "new_seat_number": 5
    }
  }
}
```

---

### 4.9 Get Audio URL (Presigned)

```
GET /api/admin/registrations/:id/audio
```

**Response 200:**
```json
{
  "success": true,
  "data": {
    "audio_url": "https://r2.cloudflarestorage.com/...?X-Amz-Signature=...",
    "expires_in": 3600,
    "phrase": "I confirm my participation in mission MNY-482.",
    "duration_ms": 3200
  }
}
```

---

### 4.10 Export Registrations

```
GET /api/admin/missions/:id/export?format=csv
```

**Response:** CSV file download

**CSV Columns:**
```
sequence,name,member_id,status,seat_number,waitlist_position,registration_time,audio_exists
1,Youssef Ayman,102583,CONFIRMED,7,,2026-09-03 17:30:00,true
2,Ahmed Ali,102584,CONFIRMED,8,,2026-09-03 17:31:00,true
...
```

---

## 5. Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| GET /api/missions/:code | 60 req/min | per IP |
| GET /api/public/volunteers/by-member-id/:id | 30 req/min | per IP |
| POST /api/registration/prepare | 10 req/min | per IP |
| POST /api/registration/submit | 10 req/min | per IP |
| POST /api/admin/login | 5 req/min | per IP |
| All other admin | 120 req/min | per session |

---

## 6. Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| VALIDATION_ERROR | 400 | Invalid input data |
| MISSION_NOT_FOUND | 404 | Mission does not exist |
| MISSION_CLOSED | 400 | Registration is closed |
| ALREADY_REGISTERED | 409 | Duplicate registration |
| INVALID_CREDENTIALS | 401 | Wrong username/password |
| UNAUTHORIZED | 401 | Not authenticated |
| FORBIDDEN | 403 | Not authorized |
| AUDIO_REQUIRED | 400 | Missing audio confirmation |
| AUDIO_TOO_SHORT | 400 | Recording < 1.5s |
| AUDIO_TOO_LONG | 400 | Recording > 10s |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |

---

## 7. Idempotency

The `request_id` field in registration submission ensures idempotency:

1. Frontend generates a unique `request_id` (UUID) per registration attempt
2. Backend stores it in `registrations.request_id`
3. If the same `request_id` is submitted again, return the existing result
4. Prevents double-registration from network retries or double-clicks

---

**Next Step:** Phase 1 — Foundation
