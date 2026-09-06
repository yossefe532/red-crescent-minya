# ARCHITECTURE — Red Crescent Minya Smart Mission Registration System

**Date:** 2026-09-03  
**Version:** MVP v1.0

---

## 1. System Overview

A lightweight, mobile-first web system replacing WhatsApp-based volunteer mission registration for the Egyptian Red Crescent — Minya Branch.

**Core principle:** "WhatsApp mission registration, but fixed."

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE EDGE                          │
│                                                                 │
│   ┌─────────────────┐         ┌─────────────────────────────┐   │
│   │  Cloudflare     │         │  Cloudflare Workers          │   │
│   │  Pages          │────────▶│  (Hono + TypeScript)         │   │
│   │  (React + Vite) │  fetch  │                              │   │
│   └─────────────────┘         │  ┌────────────────────────┐  │   │
│                               │  │  Routes                │  │   │
│                               │  │  ├── /api/public/*     │  │   │
│                               │  │  ├── /api/registration/*│  │   │
│                               │  │  └── /api/admin/*      │  │   │
│                               │  └────────────────────────┘  │   │
│                               │  ┌────────────────────────┐  │   │
│                               │  │  Services              │  │   │
│                               │  │  ├── mission.service   │  │   │
│                               │  │  ├── volunteer.service │  │   │
│                               │  │  ├── registration.     │  │   │
│                               │  │  │   service            │  │   │
│                               │  │  ├── audio.service     │  │   │
│                               │  │  └── admin.service     │  │   │
│                               │  └────────────────────────┘  │   │
│                               └──────────┬──────────────────┘   │
│                                          │                       │
│                    ┌─────────────────────┼─────────────────┐     │
│                    ▼                     ▼                 ▼     │
│              ┌──────────┐         ┌──────────┐      ┌────────┐  │
│              │  D1      │         │  R2      │      │ Turn-  │  │
│              │  (SQLite)│         │  (Audio) │      │ stile  │  │
│              └──────────┘         └──────────┘      └────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

### Backend

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Runtime | Cloudflare Workers | Serverless, edge-distributed, free tier generous |
| Framework | Hono | Lightweight, fast, Workers-native, TypeScript-first |
| Database | Cloudflare D1 | Serverless SQLite, native Workers binding |
| Storage | Cloudflare R2 | Zero egress fees, presigned URLs for private audio |
| Validation | Zod | TypeScript-first schema validation |
| Auth | Cookie + bcrypt | Simple, no external service, secure |

### Frontend

| Layer | Technology | Justification |
|-------|-----------|---------------|
| Framework | React 18+ | Component model, wide adoption |
| Build | Vite | Fast HMR, small bundles, optimized builds |
| Styling | Tailwind CSS | Utility-first, mobile-first, small CSS |
| State | React Query (TanStack) | Server state, caching, polling, retries |
| Routing | React Router v6 | Simple, declarative routing |
| Audio | MediaRecorder API | Native browser, no dependencies |

---

## 4. Directory Structure

```
red-crescent-minya/
├── docs/
│   ├── PROJECT_AUDIT.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── API.md
│   ├── MVP_SCOPE.md
│   └── FUTURE_FEATURES.md
│
├── backend/
│   ├── wrangler.toml
│   ├── package.json
│   ├── tsconfig.json
│   ├── migrations/
│   │   └── 0001_init.sql
│   └── src/
│       ├── index.ts              # Worker entry + Hono app
│       ├── env.ts                # Environment types
│       ├── middleware/
│       │   ├── auth.ts           # Admin auth middleware
│       │   ├── rate-limit.ts     # Rate limiting
│       │   └── error-handler.ts  # Global error handler
│       ├── routes/
│       │   ├── public.ts         # Public mission endpoints
│       │   ├── registration.ts   # Registration flow
│       │   └── admin.ts          # Admin-only endpoints
│       ├── services/
│       │   ├── mission.service.ts
│       │   ├── volunteer.service.ts
│       │   ├── registration.service.ts
│       │   ├── audio.service.ts
│       │   └── admin.service.ts
│       ├── db/
│       │   ├── schema.ts         # D1 schema definitions
│       │   └── queries.ts        # Reusable query builders
│       ├── validation/
│       │   ├── mission.schema.ts
│       │   ├── registration.schema.ts
│       │   └── admin.schema.ts
│       └── utils/
│           ├── id.ts             # ID generators (REG-000482, MNY-482)
│           ├── crypto.ts         # Token hashing, session secrets
│           └── response.ts       # Standardized API responses
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── ui/               # Button, Input, Card, etc.
│       │   ├── layout/           # Header, Footer, Container
│       │   └── audio/            # Recorder, Player
│       ├── pages/
│       │   ├── MissionPage.tsx   # Public registration page
│       │   ├── ResultPage.tsx    # Success/waitlist result
│       │   ├── AdminLogin.tsx
│       │   ├── AdminDashboard.tsx
│       │   └── AdminMission.tsx
│       ├── features/
│       │   ├── missions/
│       │   ├── registration/
│       │   └── admin/
│       ├── lib/
│       │   ├── api.ts            # API client
│       │   └── query.ts          # React Query config
│       └── utils/
│           ├── format.ts
│           └── constants.ts
│
└── README.md
```

---

## 5. Key Architectural Decisions

### 5.1 Backend: Hono on Workers

**Why Hono?**
- Minimal overhead (~4ms cold start)
- Built-in middleware (cors, jwt, logger)
- Native Workers types
- Excellent TypeScript support

### 5.2 Database: D1 with SQLite Semantics

**Why D1?**
- Zero infrastructure management
- Native Workers binding (`env.DB`)
- SQLite compatibility (familiar SQL)
- Free tier: 5GB storage, 5M row reads/day

**Concurrency strategy:**
- SQLite serializes writes — D1 handles this natively
- Use `BEGIN IMMEDIATE TRANSACTION` for seat allocation
- Unique constraints enforce duplicate prevention at DB level

### 5.3 Audio: R2 with Presigned URLs

**Why R2?**
- No egress fees (unlike S3)
- Presigned URLs for temporary private access
- Native Workers binding (`env.AUDIO_BUCKET`)

**Flow:**
1. Frontend requests presigned upload URL from backend
2. Frontend uploads audio directly to R2
3. Backend stores `audio_key` in database
4. Admin requests playback → backend generates presigned GET URL

### 5.4 Authentication: Cookie-Based Sessions

**Why not JWT?**
- Simpler for MVP
- HttpOnly cookies = XSS protection
- No token storage on client

**Admin auth flow:**
1. POST /api/admin/login with credentials
2. Verify against `admin_users` table (bcrypt)
3. Set HttpOnly cookie with signed session token
4. Middleware validates cookie on protected routes

### 5.5 Frontend: React + Vite + Tailwind

**Why this stack?**
- Vite: fastest dev server, smallest production bundles
- Tailwind: utility-first CSS, no custom CSS files, mobile-first
- React Query: handles polling, caching, retries automatically

---

## 6. Data Flow

### Registration Flow (Happy Path)

```
Volunteer                    Frontend              Backend              D1         R2
   │                           │                    │                   │          │
   │── Open /m/MNY-482 ──────▶│                    │                   │          │
   │                           │── GET mission ────▶│                   │          │
   │                           │                    │── SELECT mission ▶│          │
   │                           │                    │◀── mission data ──│          │
   │                           │◀── mission info ──│                   │          │
   │                           │                    │                   │          │
   │── Enter Member ID ───────▶│                    │                   │          │
   │                           │── GET volunteer ──▶│                   │          │
   │                           │                    │── SELECT vol ────▶│          │
   │                           │                    │◀── found: name ───│          │
   │                           │◀── name auto ─────│                   │          │
   │                           │                    │                   │          │
   │── Record audio ──────────▶│                    │                   │          │
   │                           │── POST prepare ───▶│                   │          │
   │                           │                    │── INSERT attempt ▶│          │
   │                           │◀── attempt_id ────│                   │          │
   │                           │                    │                   │          │
   │                           │── POST audio ─────▶│                   │          │
   │                           │                    │── presign PUT ────│─────────▶│
   │                           │◀── upload URL ────│                   │          │
   │                           │── PUT audio ─────────────────────────────────────▶│
   │                           │                    │                   │          │
   │                           │── POST submit ────▶│                   │          │
   │                           │                    │── BEGIN TX ───────▶│          │
   │                           │                    │── check capacity──▶│          │
   │                           │                    │── allocate seat ──▶│          │
   │                           │                    │── COMMIT ─────────▶│          │
   │                           │◀── result ────────│                   │          │
   │                           │                    │                   │          │
   │◀── Show result (#7) ─────│                    │                   │          │
```

---

## 7. Security Architecture

| Layer | Measure |
|-------|---------|
| Transport | HTTPS enforced (Cloudflare) |
| Input | Zod validation on all endpoints |
| SQL | Parameterized queries only (no string interpolation) |
| Auth | HttpOnly + Secure + SameSite cookies |
| Audio | Presigned URLs with short expiry (15-60 min) |
| Rate Limiting | Per-IP limits on public endpoints |
| CORS | Strict origin whitelist |
| Headers | Security headers via Hono middleware |
| Secrets | Wrangler secrets / environment variables |

---

## 8. Performance Targets

| Metric | Target | Strategy |
|--------|--------|----------|
| Page load | < 2s on 4G | Code splitting, minimal JS, Tailwind purge |
| API response | < 200ms | Edge execution, D1 local reads |
| Registration | < 500ms | Optimistic UI, atomic DB transaction |
| Audio upload | < 1s | Direct-to-R2 presigned URL |

---

## 9. Deployment

| Environment | Service | Trigger |
|-------------|---------|---------|
| Production | Cloudflare Pages | Push to `main` |
| Staging | Cloudflare Pages (preview) | Pull requests |
| Backend | Cloudflare Workers | `wrangler deploy` |
| Database | D1 | `wrangler d1 apply` |

---

**Next Step:** Phase 1 — Foundation
