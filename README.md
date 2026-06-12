# Rex API — v3 (Fastify + TypeScript)

REST API untuk aplikasi, bot WhatsApp, dan automation tools. Repositori-Service-Routes layering, Supabase sebagai persistence layer, Swagger docs di `/docs`.

## Quick start

```bash
cp .env.example .env
# Generate API_KEY_ENC_KEY:
openssl rand -hex 32
# Isi SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

- Landing page: http://localhost:3000/
- Dashboard: http://localhost:3000/dashboard
- Admin console: http://localhost:3000/admin
- Swagger docs: http://localhost:3000/docs

## Docker

```bash
docker build -t rex-api .
docker run --rm -p 3000:3000 --env-file .env rex-api
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Hot reload via `tsx watch` |
| `npm run build` | Compile ke `dist/` via `tsc` + copy assets |
| `npm start` | Jalankan `dist/server.js` |
| `npm test` | Run vitest |
| `npm run typecheck` | TypeScript check only |

## Project layout

```
src/
├── server.ts
├── app.ts                   # buildApp() — register plugins + routes
├── bootstrap.ts             # first-start master API key provisioning
├── config/env.ts            # zod-validated env loader
├── plugins/                 # cross-cutting Fastify plugins
│   ├── errorHandler.ts
│   ├── supabase.ts
│   ├── swagger.ts
│   ├── auth.ts
│   ├── rateLimit.ts
│   └── quota.ts
├── shared/
│   ├── errors.ts
│   ├── geminiRotator.ts     # Gemini API key rotation
│   ├── groqRotator.ts       # Groq API key rotation
│   ├── browser/
│   └── utils/               # lruCache, ssrfGuard
└── modules/
    ├── health/
    ├── auth/
    ├── apiKeys/
    ├── auditLog/
    ├── adminUsers/
    ├── me/
    ├── quota/
    ├── rateLimit/
    ├── ai/
    │   ├── imagegen/        # Image generation via Cloudflare Workers AI
    │   └── stt/             # Speech-to-text via Groq Whisper
    ├── downloaders/
    │   ├── youtube/
    │   ├── tiktok/
    │   ├── instagram/
    │   ├── facebook/
    │   └── pinterest/
    ├── makers/
    │   ├── brat/
    │   ├── quote/
    │   ├── smeme/
    │   ├── miq/
    │   ├── iqc/
    │   └── qc/
    └── tools/
        ├── screenshot/
        ├── exif/
        ├── shortlinks/
        ├── tgsticker/
        ├── qr/              # QR code generator
        ├── waifu/           # Anime character search (Jikan/MAL)
        ├── skinfilter/      # Skin darkening filter (OpenCV + Gemini)
        ├── iplookup/        # IP geolocation (MaxMind GeoLite2)
        └── translate/       # Text translation (Groq LLM)
tests/
supabase/schema.sql
supabase/migrations/
data/                        # MaxMind .mmdb files (gitignored)
```

## Endpoints

### Auth
| Path | Method | Auth | Notes |
|---|---|---|---|
| `/api/health`, `/api/ready` | GET | none | Liveness/readiness |
| `/api/auth/register`, `/api/auth/login` | POST | none | Returns JWT |

### Me (self-service)
| Path | Method | Auth | Notes |
|---|---|---|---|
| `/api/me` | GET | JWT | Profile |
| `/api/me/key` | GET | JWT | API key info |
| `/api/me/key/reveal` | POST | JWT + password | Reveal plaintext key |
| `/api/me/key/regenerate` | POST | JWT + password | Rotate key |
| `/api/me/usage` | GET | JWT | Daily usage |

### Admin
| Path | Method | Auth | Notes |
|---|---|---|---|
| `/api/keys` | GET/POST/PATCH/DELETE | master key | CRUD API keys |
| `/api/keys/:id/regenerate` | POST | master key | Rotate key |
| `/api/keys/:id/activate` | POST | master key | Un-revoke key |
| `/api/keys/:id/reveal` | GET | master key | Reveal plaintext |
| `/api/keys/pool-stats` | GET | master key | Chromium pool metrics |
| `/api/keys/audit-log` | GET | master key | Admin action log |
| `/api/admin/users` | GET | master key | User list |

### Downloaders
| Path | Method | Notes |
|---|---|---|
| `/api/download/youtube` | GET | Download YouTube video/audio via yt-dlp |
| `/api/download/tiktok` | GET | Download TikTok video |
| `/api/download/instagram` | GET | Download Instagram photo/video/reels |
| `/api/download/facebook` | GET | Download Facebook video |
| `/api/download/pinterest` | GET | Download Pinterest image/video |

### Makers
| Path | Method | Notes |
|---|---|---|
| `/api/brat` | GET | Generate brat-style image |
| `/api/quote` | GET | Generate quote card |
| `/api/smeme` | GET | Generate stiker meme |
| `/api/miq` | GET | Maker IQ card |
| `/api/iqc` | GET | IQ certificate |
| `/api/qc` | GET | Quote card |

### Tools
| Path | Method | Notes |
|---|---|---|
| `/api/screenshot` | GET | Screenshot halaman web |
| `/api/exif` | POST | Extract EXIF metadata dari gambar |
| `/api/shortlinks` | GET/POST/DELETE | URL shortener |
| `/api/qr` | GET | Generate QR code (PNG/SVG) |
| `/api/waifu/random` | GET | Random anime character |
| `/api/waifu/search` | GET | Cari anime character by nama |
| `/api/skinfilter` | GET | Skin darkening filter (OpenCV + MediaPipe) |
| `/api/iplookup` | GET | IP geolocation lookup |
| `/api/translate` | GET | Translate teks (Groq LLM) |

### AI
| Path | Method | Notes |
|---|---|---|
| `/api/ai/imagegen` | GET | Generate gambar dari prompt (Cloudflare Workers AI + Groq) |
| `/api/ai/stt` | POST | Speech-to-text via Groq Whisper (upload file atau URL) |

## Environment Variables

Lihat `.env.example` untuk dokumentasi lengkap. Variabel penting:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | ✅ | Min 32 chars |
| `API_KEY_ENC_KEY` | ✅ | 64 hex chars (`openssl rand -hex 32`) |
| `SUPABASE_URL` | ✅ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | |
| `MASTER_API_KEY_BOOTSTRAP` | First run | Format: `rex_<base64url>` |
| `GEMINI_API_KEYS` | Skinfilter | Comma-separated |
| `GROQ_API_KEYS` | STT, Translate, Imagegen | Comma-separated |
| `CF_WORKER_URL` | Imagegen | URL Cloudflare Worker |
| `CF_WORKER_API_KEY` | Imagegen | |
| `GEOIP_CITY_DB` | IP Lookup | Path ke GeoLite2-City.mmdb |
| `GEOIP_ASN_DB` | IP Lookup | Path ke GeoLite2-ASN.mmdb |
| `COBALT_API_URL` | Downloaders | Default: public instance |
| `YTDLP_COOKIES_PATH` | Pinterest/YouTube | Netscape cookies format |

## External Dependencies

- **Supabase** — database & auth
- **Groq** — Whisper STT, text translation, imagegen prompt processing
- **Gemini** — skin darkening filter (image editing)
- **Cloudflare Workers AI** — image generation (self-deployed worker)
- **MaxMind GeoLite2** — IP geolocation (offline database, download required)
- **Cobalt** — media downloader (self-host recommended)
- **yt-dlp** — YouTube/Pinterest fallback downloader
- **MediaPipe + OpenCV** — skin detection untuk skinfilter endpoint (Python)

## Tier policy

| Tier | Rate limit | Daily quota |
|---|---|---|
| master key | none | unlimited |
| user key (`dailyLimit: null`) | per-endpoint | unlimited |
| user key (numeric `dailyLimit`) | per-endpoint | enforced |
| anon (no key) | base budget | `ANON_DAILY_QUOTA` per IP |

## Database

Jalankan `supabase/schema.sql` sekali di Supabase SQL editor. Setelah itu apply migrations secara berurutan:

```bash
# Di Supabase SQL editor:
supabase/migrations/001_audit_log.sql
```

## Bootstrap

Saat pertama start dengan `MASTER_API_KEY_BOOTSTRAP` di-set, server otomatis buat master key. Setelah server log `"provisioned master API key"`, hapus variable itu dari `.env`.

## Conventions

- **Routes** — declare Zod schemas; Swagger auto-generate docs
- **Services** — business logic, throw `AppError`
- **Repositories** — satu-satunya yang akses `app.supabase`
- **Plugins** — pakai `fastify-plugin` (`fp`) agar decorators leak ke parent scope
