# Red Crescent Minya — Smart Mission Registration System

## Quick Start

### Prerequisites
- Node.js v24+ (already installed)
- Cloudflare account (free tier)
- Wrangler CLI: `npm install -g wrangler`

### Development

```bash
# Backend
cd backend
npm install
npm run dev          # Local Workers + D1

# Frontend
cd frontend
npm install
npm run dev          # Vite dev server
```

### Deployment

```bash
# Backend
cd backend
npm run deploy       # Workers + D1 + R2

# Frontend
cd frontend
npm run build        # Output to dist/
```

## Project Structure

```
red-crescent-minya/
├── docs/                    # Documentation
├── backend/                 # Cloudflare Workers API
│   ├── src/
│   │   ├── index.ts         # Hono app entry
│   │   ├── env.ts           # Environment bindings
│   │   ├── middleware/      # Auth, rate-limit, error-handler
│   │   ├── routes/          # public, registration, admin
│   │   ├── services/        # Business logic
│   │   ├── db/              # Schema + queries
│   │   ├── validation/      # Zod schemas
│   │   └── utils/           # ID generators, crypto
│   ├── migrations/          # D1 SQL migrations
│   ├── wrangler.toml        # Cloudflare config
│   └── package.json
├── frontend/                # React + Vite
│   ├── src/
│   │   ├── main.tsx         # React entry
│   │   ├── App.tsx          # Router
│   │   ├── components/      # UI components
│   │   ├── pages/           # Mission, Result, Admin
│   │   ├── features/        # Feature modules
│   │   ├── lib/             # API client, query config
│   │   └── utils/           # Helpers
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
└── README.md
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Cloudflare Workers + Hono |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| Frontend | React + Vite + Tailwind CSS |
| Auth | Cookie-based sessions |
| Validation | Zod |

## License

Internal project for Egyptian Red Crescent — Minya Branch.
