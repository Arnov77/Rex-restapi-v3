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
├── server.ts                # process bootstrap
├── app.ts                   # buildApp() — registers plugins + routes
├── config/env.ts            # zod-validated env loader
├── plugins/                 # cross-cutting Fastify plugins
│   ├── errorHandler.ts
│   ├── supabase.ts
│   ├── swagger.ts
│   ├── auth.ts              # JWT + API-key decorators
│   └── rateLimit.ts         # Supabase-backed rate-limit factory
├── shared/
│   └── errors.ts            # AppError + helpers
└── modules/                 # one folder per feature
    ├── health/
    ├── auth/                # routes + service + repo + schemas
    ├── apiKeys/
    └── rateLimit/
tests/                       # vitest, TDD-friendly
supabase/schema.sql          # apply once via Supabase SQL editor
```

## Conventions

- **Routes** declare zod schemas; Swagger picks them up automatically.
- **Services** contain business logic. They throw `AppError` (`Conflict`, `Unauthorized`, …) — the central error handler renders the JSON response.
- **Repositories** are the only files that touch `app.supabase`. Pure async, no caching.
- **Plugins** add cross-cutting capabilities via `fastify-plugin` (`fp`) so decorators leak to the parent scope.

## Database

Run `supabase/schema.sql` once in the Supabase SQL editor. The server connects with the service-role key and bypasses RLS.
