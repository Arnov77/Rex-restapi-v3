# Rex API — v3 (Fastify + TypeScript)

WhatsApp-bot oriented REST API. Repositori-Service-Routes layering, Supabase as the only persistence layer, Swagger docs di `/docs`.

## Quick start

```bash
cp .env.example .env
# generate API_KEY_ENC_KEY:
openssl rand -hex 32
# fill SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

Open http://localhost:3000/docs for Swagger UI.

## Scripts

- `npm run dev` — hot reload via `tsx watch`
- `npm run build` — emit `dist/` via `tsc`
- `npm start` — run compiled `dist/server.js`
- `npm test` — run vitest once
- `npm run typecheck` — TypeScript check only

## Project layout

```
src/
├── server.ts                # process bootstrap (+ master-key bootstrap)
├── app.ts                   # buildApp() — registers plugins + routes
├── bootstrap.ts             # first-start master API key provisioning
├── config/env.ts            # zod-validated env loader
├── plugins/                 # cross-cutting Fastify plugins
│   ├── errorHandler.ts
│   ├── supabase.ts
│   ├── swagger.ts
│   ├── auth.ts              # JWT + API-key decorators
│   ├── rateLimit.ts         # tier-aware Supabase-backed limiter
│   └── quota.ts             # daily usage counter
├── shared/
│   ├── errors.ts            # AppError + helpers
│   ├── browser/             # singleton Chromium (screenshot/brat/quote)
│   └── utils/               # lruCache, ssrfGuard
└── modules/                 # one folder per feature
    ├── health/
    ├── auth/
    ├── apiKeys/             # admin CRUD + PATCH dailyLimit
    ├── me/                  # self-service: profile, key, usage
    ├── quota/               # daily usage repo
    ├── rateLimit/
    ├── screenshot/
    ├── brat/
    └── quote/
tests/                       # vitest specs
supabase/schema.sql          # apply once via Supabase SQL editor
```

## Endpoints

| Path | Auth | Notes |
|---|---|---|
| `GET /api/health`, `GET /api/ready` | none | Liveness/readiness probes |
| `POST /api/auth/register`, `/login` | none | Returns JWT + auto-provisions a user API key |
| `GET /api/me` | JWT | Self profile |
| `GET /api/me/key` | JWT | Self API key (no plaintext) |
| `POST /api/me/key/reveal` | JWT + password | Reveal stored plaintext (404 if not stored) |
| `POST /api/me/key/regenerate` | JWT + password | Rotate secret; key id preserved (quota survives) |
| `GET /api/me/usage` | JWT | Today's UTC usage + limit |
| `GET /api/keys`, `POST`, `PATCH`, `DELETE` | master API key | Admin CRUD |
| `GET /api/keys/:id/reveal` | master API key | Reveal stored plaintext |
| `GET /api/screenshot`, `/brat`, `/quote` | optional API key | Heavy renderers; tier-aware quota + rate-limit |

## Tier policy

- **master** API key → no rate-limit, no daily quota
- **user** API key → daily quota (`USER_DAILY_QUOTA` or per-key override) + 2× anon per-minute budget
- **anon** (no key) → daily quota (`ANON_DAILY_QUOTA`) keyed by IP, base per-minute budget

## Conventions

- **Routes** declare zod schemas; Swagger picks them up automatically.
- **Services** contain business logic. They throw `AppError` (`Conflict`, `Unauthorized`, …) — the central error handler renders the JSON response.
- **Repositories** are the only files that touch `app.supabase`. Pure async, no caching.
- **Plugins** add cross-cutting capabilities via `fastify-plugin` (`fp`) so decorators leak to the parent scope.

## Database

Run `supabase/schema.sql` once in the Supabase SQL editor. The server connects with the service-role key and bypasses RLS.
