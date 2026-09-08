# Red Crescent Minya - Smart Mission Registration System MVP

## 🏗️ Architecture

- **Backend**: Cloudflare Workers (Hono + TypeScript)
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2 (audio files)
- **Frontend**: React + Vite + TailwindCSS (RTL)
- **Deployment**: Cloudflare Pages

## 🚀 Quick Start

### Prerequisites
- Node.js v24+
- npm 11+
- wrangler 3.x (`npm install -g wrangler`)

### Backend Setup
```bash
cd backend
npm install
npx wrangler d1 execute red-crescent-minya --file=./migrations/0001_init.sql --local
npm run dev  # Port 8787
```

### Frontend Setup
```bash
cd frontend
npm install
npm run dev  # Port 5173
```

### Admin Credentials
- Username: `admin`
- Password: `admin123`

## 📋 Features
- Mission creation with registration management
- Volunteer registration with voice confirmation
- Quick profile save/load
- Temporary registration (without member ID)
- Live registration table (3s polling)
- Mission control panel (toggle/edit/close)
- CSV export with UTF-8 BOM (Excel Arabic compatible)
- Duplicate registration prevention (member_id per mission)
- Auto-promotion from waitlist to confirmed

## 🔐 Security
- Admin sessions in D1 (24h expiry)
- Password hashing (bcrypt via Cloudflare bindings)
- No API keys in source code - all secrets in environment variables
- X-Auth-Token header + Cookie authentication

## 📊 Database Tables
- `admin_users` - Admin accounts
- `admin_sessions` - Session management
- `missions` - Mission data
- `registrations` - Volunteer registrations
- `audio_confirmations` - Voice recordings (R2 storage)
- `volunteers` - Volunteer profiles
- `registration_attempts` - Audit trail
- `audit_log` - System audit
- `quick_profiles` - Quick profile save

## 🔄 Migration History
- `migrations/0001_init.sql` - 8 tables (initial)
- `migrations/0002_add_phone_and_quick_register.sql` - Phone + quick profiles

## 📝 License
Private - Egyptian Red Crescent Minya Branch
