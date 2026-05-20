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

Open http://localhost:3000/ for the public landing page (lightweight, pure HTML), http://localhost:3000/dashboard for the Vue 3 playground & self-service panel, http://localhost:3000/admin for the operator admin console, or http://localhost:3000/docs for the Swagger reference.

## Docker

```bash
docker build -t rex-api .
docker run --rm -p 3000:3000 --env-file .env rex-api
```

The image ships system Chromium for the Playwright-based render endpoints (screenshot/brat/quote). If you mount a different `public/` directory, point at it with `STATIC_DIR=/abs/path`.

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
    ├── apiKeys/             # admin CRUD + activate/regenerate + pool-stats
    ├── auditLog/            # admin action log (create/revoke/activate/regen/update)
    ├── adminUsers/          # admin user list endpoint
    ├── me/                  # self-service: profile, key, usage
    ├── quota/               # daily usage repo
    ├── rateLimit/
    ├── screenshot/
    ├── brat/
    └── quote/
tests/                       # vitest specs
supabase/schema.sql          # apply once via Supabase SQL editor
supabase/migrations/         # incremental migrations (apply after schema.sql)
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
| `POST /api/keys/:id/regenerate` | master API key | Rotate secret (plaintext shown once) |
| `POST /api/keys/:id/activate` | master API key | Un-revoke a key |
| `GET /api/keys/:id/reveal` | master API key | Reveal stored plaintext |
| `GET /api/keys/pool-stats` | master API key | Live Chromium page-pool metrics |
| `GET /api/keys/audit-log` | master API key | Paginated admin action log |
| `GET /api/admin/users` | master API key | Paginated user list with search |
| `GET /api/screenshot`, `/brat`, `/quote` | optional API key | Heavy renderers; tier-aware quota + rate-limit |

## Tier policy

- **master** API key → no rate-limit, no daily quota
- **user** API key with `dailyLimit: null` → **unlimited** (admin explicitly set no cap)
- **user** API key with numeric `dailyLimit` → enforced at that number per UTC day
- **anon** (no key) → daily quota (`ANON_DAILY_QUOTA`) keyed by IP, base per-minute budget

## Conventions

- **Routes** declare zod schemas; Swagger picks them up automatically.
- **Services** contain business logic. They throw `AppError` (`Conflict`, `Unauthorized`, …) — the central error handler renders the JSON response.
- **Repositories** are the only files that touch `app.supabase`. Pure async, no caching.
- **Plugins** add cross-cutting capabilities via `fastify-plugin` (`fp`) so decorators leak to the parent scope.

## Database

Run `supabase/schema.sql` once in the Supabase SQL editor. The server connects with the service-role key and bypasses RLS.

### Migrations

After the initial schema, apply incremental migrations in order:

```bash
# In Supabase SQL editor, paste:
supabase/migrations/001_audit_log.sql   # adds rexapi.audit_log table
```

## Admin console (`/admin`)

Master-key-gated operator UI at `/admin`. Features:

- **Auth gate** — paste master API key (stored in `localStorage['rex.masterApiKey']`)
- **Health pill** — polls `/api/ready` every 5s
- **Pool stats** — live Chromium page-pool metrics
- **API Keys tab** — list, create, edit limit, regenerate, revoke, activate (un-revoke)
- **Users tab** — list all users with search by username/email
- **Audit Log tab** — paginated history of all admin key actions

All admin endpoints are hidden from `/docs` (schema.hide: true).

## Bootstrap

On first start with `MASTER_API_KEY_BOOTSTRAP` set, the server creates a master key using that value as plaintext. After bootstrap, **remove the env var**.

If the bootstrap key was revoked and the server restarts with the same env var still set, it will log a warning and skip (no crash). Set a new env value to provision a fresh master key.
