# Rex API

A single REST API for media downloaders, AI tools, image generators, games,
and web utilities — built for bots, apps, and automations. Fastify +
TypeScript, Supabase for persistence, and a live Swagger UI at `/docs` for
every endpoint below.

- **Live docs / try it out:** `/docs`
- **Dashboard (sign up, get a key, test endpoints):** `/dashboard`
- **Stack:** Fastify · TypeScript · Zod · Supabase

This README has three parts:

1. **[Using the API](#using-the-api)** — for anyone calling the hosted API.
2. **[Self-hosting](#self-hosting)** — for running your own instance.
3. **[Development](#development)** — for working on this codebase.

---

## Using the API

### Authentication

Every request is authenticated with an API key, sent as a header:

```
X-API-Key: rex_xxxxxxxxxxxxxxxxxxxx
```

Get a key by registering an account through `/dashboard` (or `/api/auth/register`).
Unauthenticated requests are allowed on most endpoints too, at a lower,
IP-based daily quota — good for quick testing, not for production traffic.

### Quick example

```bash
curl "https://your-host/api/downloader/youtube?url=https://youtu.be/dQw4w9WgXcQ" \
  -H "X-API-Key: rex_xxxxxxxxxxxxxxxxxxxx"
```

Every endpoint follows the same response shape:

```json
{ "ok": true, "data": { ... } }
```

or, on error:

```json
{ "ok": false, "error": { "message": "..." } }
```

### Endpoint categories

The full, always-current list — with request/response schemas you can run
directly from the browser — lives at `/docs`. Here's the map of what's
available, grouped by base path:

| Base path | What's there |
|---|---|
| `/api/downloader/*` | YouTube, TikTok, Instagram, Facebook, Twitter/X, Pinterest, SoundCloud, Spotify, MediaFire — video/audio downloads and MP3 extraction |
| `/api/ai/*` | AI chat assistant, Islamic-knowledge assistant, image generation, speech-to-text |
| `/api/maker/*` | Image generators — quote cards, caption cards, meme stickers, Telegram stickers, achievement cards |
| `/api/tools/*` | Web utilities — screenshots, OCR, translation, text-to-speech, QR codes, EXIF metadata, background removal, IP lookup, shortlinks, NSFW detection |
| `/api/search/*` | Manga and Pinterest search |
| `/api/games/*` | Trivia and word-game endpoints (Indonesian-language content) |
| `/api/fun/*` | Novelty endpoints (Indonesian-language content) |
| `/api/me/*` | Self-service: your profile, API key, and daily usage |
| `/api/auth/*` | Register and sign in |

Operator-only endpoints (`/api/keys/*`, `/api/admin/*`) require a master key
and are documented in `/docs` as well, but aren't meant for public callers.

### Rate limits and quotas

| Tier | Rate limit | Daily quota |
|---|---|---|
| Anonymous (no key) | Shared per-IP budget | `ANON_DAILY_QUOTA` per IP |
| Registered user key | Per-endpoint | Enforced, per your plan |
| Master key (operator) | None | Unlimited |

Check your current usage anytime at `/api/me/usage` or on the `/profile` page.

---

## Self-hosting

Everything below is for running your own instance. If you're just calling
the hosted API, you don't need any of this.

### Prerequisites

```bash
apt update && apt install -y \
  nodejs ffmpeg deno \
  python3.11 python3.11-venv curl git
```

> Node.js v22+ is recommended. Check with `node --version`.

**Docker is optional.** The app runs fine directly on Node — `npm install`
+ `npm run dev`/`npm start`, no Docker involved. You only need Docker for
either of these two specific, unrelated things (the Chromium note further
below is the one thing on this page you likely do need, regardless):

- Running the app itself inside a container instead of directly with
  Node (see [Docker](#docker)) — purely a deployment preference.
- The bgutil PO Token provider, if you set up more resilient YouTube
  downloads later (see [YouTube downloads](#optional-youtube-downloads-yt-dlp)).

If you do need it, install with the official convenience script:

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version   # verify
```

If you'd rather not run the install script as root, follow Docker's own
[install guide](https://docs.docker.com/engine/install/) for your
distribution instead — the script above is just the fastest path on a
fresh Debian/Ubuntu VPS.

**Chromium (for Playwright).** `screenshot`, `brat`, and `quote` render
pages headlessly via `playwright-core`, which — unlike the full `playwright`
package — does **not** download a browser for you. If you're running via
Docker, skip this entirely — the image already bundles Chromium. Running
directly on Node, pick one:

- **Option A — system Chromium (matches what the Dockerfile does):**
  ```bash
  apt install -y chromium fonts-liberation fonts-noto-color-emoji \
    libnss3 libxss1 libasound2
  ```
  Then point the app at it in `.env`:
  ```env
  CHROME_BIN=/usr/bin/chromium
  ```

- **Option B — let Playwright download its own build:**
  ```bash
  npx playwright-core install --with-deps chromium
  ```
  Leave `CHROME_BIN` unset in `.env` — `playwright-core` will find the
  browser it just downloaded on its own.

Either works; Option A is what the Docker image uses, so it's the one to
match if you want dev and prod to behave identically. Whichever you pick,
skip it only if you don't need `screenshot`/`brat`/`quote` — every other
endpoint works fine without a browser installed.

### Quick start

```bash
cp env.example .env
# Generate API_KEY_ENC_KEY:
openssl rand -hex 32
# Fill in SUPABASE_URL & SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
```

- Landing page: http://localhost:3000/
- Dashboard: http://localhost:3000/dashboard
- Admin console: http://localhost:3000/admin
- Swagger docs: http://localhost:3000/docs

See [Environment variables](#environment-variables) below for what else the
app expects, and [Database](#database) to provision Supabase.

### Docker

An alternative to the Quick start above — build and run the whole thing as
a container instead of with `npm`. Requires Docker (see
[Prerequisites](#prerequisites)). The image already bundles Chromium, so
you can skip the Playwright setup entirely if you're only running this way:

```bash
docker build -t rex-api .
docker run --rm -p 3000:3000 --env-file .env rex-api
```

### Optional: YouTube downloads (yt-dlp)

The `/api/downloader/youtube` endpoint shells out to `yt-dlp`. It works
without any of this setup for a while, but YouTube eventually rate-limits or
flags server IPs, at which point you'll need cookies, a proxy, and a PO
Token provider — the PO Token provider (bgutil, step 2 below) runs as a
Docker container, so make sure Docker is installed first (see
[Prerequisites](#prerequisites)). Skip this section entirely if you don't
need YouTube downloads, or come back to it once you see failures.

<details>
<summary>Full yt-dlp setup (cookies, proxy, PO Token, troubleshooting)</summary>

#### 1. Install yt-dlp

Install via pip on Python 3.11 (must match the Python used elsewhere on the box):

```bash
curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11
python3.11 -m pip install yt-dlp
python3.11 -m pip install bgutil-ytdlp-pot-provider

# Verify
yt-dlp --version
which yt-dlp   # should be /usr/local/bin/yt-dlp
head -1 $(which yt-dlp)  # should be #!/usr/bin/python3.11
```

#### 2. bgutil Docker (YouTube PO Token)

YouTube requires a valid PO Token to avoid bot detection. Run bgutil as a
Docker container:

```bash
docker run -d \
  --name bgutil-provider \
  --restart unless-stopped \
  -p 4416:4416 \
  brainicism/bgutil-ytdlp-pot-provider
```

Verify it's running:

```bash
curl -X POST http://127.0.0.1:4416/get_pot \
  -H "Content-Type: application/json" \
  -d '{"videoId": "dQw4w9WgXcQ", "clientName": "WEB"}'
# Should return JSON with a populated poToken
```

#### 3. yt-dlp global config

```bash
mkdir -p ~/.config/yt-dlp
cat > ~/.config/yt-dlp/config << 'EOF'
--extractor-args "youtube:po_token=web+fetch_pot"
--extractor-args "youtube:getpot_bgutil_url=http://127.0.0.1:4416"
--js-runtimes node
--remote-components ejs:github
EOF
```

> **Why each flag:**
> - `po_token=web+fetch_pot` — tells yt-dlp to fetch a PO Token via bgutil
> - `getpot_bgutil_url` — points to the bgutil Docker container on port 4416
> - `--js-runtimes node` — enables Node.js as a JS runtime (default is Deno only)
> - `--remote-components ejs:github` — downloads the JS challenge-solver script from GitHub (cached after first run)

> **Node.js binary name:** yt-dlp looks for a binary named `node`, but some
> distros name it `nodejs`. Symlink if needed:
> ```bash
> ln -sf /usr/bin/nodejs /usr/local/bin/node
> ```

#### 4. YouTube cookies

Server IPs are often flagged by YouTube and need cookies to bypass it.
Export cookies from a browser that's logged into YouTube:

1. Install the **"Get cookies.txt LOCALLY"** extension (Chrome/Firefox)
2. Visit `youtube.com` and make sure you're logged in
3. Use the extension to export cookies for `youtube.com`
4. Upload to the server:
   ```bash
   scp cookies.txt root@<server-ip>:/root/rex-api/cookies.txt
   ```
5. Point to it in `.env`:
   ```env
   YTDLP_COOKIES_PATH=./cookies.txt
   ```

> Refresh cookies every 2–4 weeks. Use an account that's actively used
> (not a fresh/empty one) — it holds up longer.

#### 5. Proxy (optional, recommended)

If the server IP is already flagged (captcha/bot errors), add an HTTP proxy:

```env
YTDLP_PROXY_URL=http://username:password@ip:port
```

Verify it works:

```bash
yt-dlp --proxy "http://user:pass@ip:port" \
  --cookies /root/rex-api/cookies.txt \
  "ytsearch1:test" --list-formats
```

You should see real audio/video formats, not just a storyboard track.

#### 6. End-to-end test

```bash
yt-dlp --cookies /root/rex-api/cookies.txt \
  "ytsearch1:despacito" --list-formats
```

A working setup lists formats like `140 m4a audio only` or `137 mp4
1920x1080`. If you only see `sb0/sb1/sb2 mhtml storyboard`, something in
cookies or bgutil isn't working — see [Troubleshooting](#troubleshooting-yt-dlp) below.

</details>

### Optional: Spotify downloads (DeezLoad)

`/api/downloader/spotify` uses a separate Python service, **DeezLoad**, which
downloads tracks via a Telegram userbot. Skip this if you don't need Spotify
downloads.

<details>
<summary>DeezLoad setup</summary>

All of this uses **Python 3.11**.

```bash
cd /root/rex-api/python/deezload
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
deactivate
```

> Always run DeezLoad inside this virtual environment so its dependencies
> don't mix with the system Python install.

**Telegram API credentials** — DeezLoad needs a Telegram userbot, which
needs an API ID and API Hash:

1. Log in at https://my.telegram.org
2. Go to **API Development Tools**
3. Create a new application
4. Copy the API ID and API Hash into `python/deezload/.env`:
   ```env
   TG_API_ID=
   TG_API_HASH=
   ```

**Generate a Telegram session** — do this once, before running DeezLoad as a
background service:

```bash
cd /root/rex-api/python/deezload
source venv/bin/activate
uvicorn deezload_service:app --host 127.0.0.1 --port 8001
```

On first run, Telethon will prompt for phone number, OTP, and 2FA password
(if set). Once logged in, `sesi_scraper.session` is created automatically.
Press `Ctrl+C` once that file exists.

> `sesi_scraper.session` holds live Telegram userbot credentials — don't
> delete or share it. Same goes for the API Hash.

</details>

### Environment variables

Full documentation is in `env.example`. The essentials:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | Yes | Min 32 chars |
| `API_KEY_ENC_KEY` | Yes | 64 hex chars (`openssl rand -hex 32`) |
| `SUPABASE_URL` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | |
| `MASTER_API_KEY_BOOTSTRAP` | First run only | Format: `rex_<base64url>` |
| `YTDLP_COOKIES_PATH` | YouTube | Path to `cookies.txt` (Netscape format) |
| `YTDLP_PROXY_URL` | YouTube | `http://user:pass@ip:port` — use if the server IP gets flagged |
| `GEMINI_API_KEYS` | OCR | Comma-separated |
| `HF_TOKENS` | Skin filter, to-anime, to-figure | Comma-separated, from huggingface.co/settings/tokens |
| `REMOVEBG_API_KEY` | Remove/change background | API key from proof.bg |
| `GROQ_API_KEYS` | STT, translate, imagegen | Comma-separated |
| `CF_WORKER_URL` / `CF_WORKER_API_KEY` | Imagegen | Your Cloudflare Worker |
| `GEOIP_CITY_DB` / `GEOIP_ASN_DB` | IP lookup | Paths to GeoLite2 `.mmdb` files |
| `COBALT_API_URL` | Downloaders | Defaults to a public instance |

### External services

| Service | Used for |
|---|---|
| **Supabase** | Database & auth |
| **Groq** | Whisper STT, translation, imagegen prompts, AI chat |
| **Gemini** | OCR (text extraction from images) |
| **Hugging Face** | Skin filter, to-anime, to-figure (AI image transforms) |
| **proof.bg** | Background removal / replacement |
| **Cloudflare Workers AI** | Image generation (self-deployed worker) |
| **MaxMind GeoLite2** | IP geolocation (offline `.mmdb`, manual download) |
| **Cobalt** | Media downloading (self-hosting recommended) |
| **yt-dlp** | YouTube downloads (+ bgutil Docker for PO Tokens) |
| **Playwright/Chromium** | Screenshots, image rendering |
| **ffmpeg** | Audio/video processing, loudness normalization |
| **Deno** | JS runtime for the yt-dlp challenge solver (fallback) |

### Database

Run `supabase/schema.sql` once in the Supabase SQL editor, then apply
migrations in order:

```bash
# In the Supabase SQL editor, run one at a time:
supabase/migrations/001_audit_log.sql
supabase/migrations/002_muslim_ai_sessions.sql
supabase/migrations/003_meme_sticker_packs.sql
```

### Bootstrap (first run)

Generate a master key:

```bash
node -e "console.log('rex_' + require('crypto').randomBytes(32).toString('base64url'))"
```

Set it in `.env`:

```env
MASTER_API_KEY_BOOTSTRAP=rex_xxxxxxxxxxxx
```

Start the server. Once you see the log line `"provisioned master API key"`,
**remove** `MASTER_API_KEY_BOOTSTRAP` from `.env` and restart.

### Troubleshooting yt-dlp

**Only storyboard formats (sb0/sb1/sb2), no audio/video** — check in order:

1. **Is bgutil running?**
   ```bash
   curl -X POST http://127.0.0.1:4416/get_pot \
     -H "Content-Type: application/json" \
     -d '{"videoId": "dQw4w9WgXcQ", "clientName": "WEB"}'
   ```
   Should return a populated `poToken`.

2. **Is the yt-dlp config in place?**
   ```bash
   cat ~/.config/yt-dlp/config
   ```
   Should have 4 lines (po_token, getpot_bgutil_url, js-runtimes, remote-components).

3. **Does yt-dlp detect Node.js?**
   ```bash
   yt-dlp -v "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --simulate 2>&1 | grep "JS runtimes"
   # Should show: [debug] JS runtimes: deno-x.x.x, node-xx.xx.x
   ```
   If `node` is missing: `ln -sf /usr/bin/nodejs /usr/local/bin/node`

4. **Are cookies still valid?**
   ```bash
   yt-dlp --cookies /root/rex-api/cookies.txt \
     "https://www.youtube.com/feed/subscriptions" --simulate 2>&1 | grep -i "account\|login"
   ```
   Should show `Found YouTube account cookies`. If not, re-export cookies from the browser.

5. **Is the server IP flagged?**
   ```bash
   yt-dlp --cookies /root/rex-api/cookies.txt "ytsearch1:test" --list-formats 2>&1 | grep -i "captcha\|bot\|sign in"
   ```
   If you see a captcha/bot error, set `YTDLP_PROXY_URL` in `.env`.

**`Signature solving failed`** — download the remote components:

```bash
yt-dlp --remote-components ejs:github \
  --cookies /root/rex-api/cookies.txt \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --list-formats
```

Make sure `--remote-components ejs:github` is in `~/.config/yt-dlp/config`.

**YouTube forcing SABR streaming** — don't pass `player_client=web`. Let
`~/.config/yt-dlp/config` handle it; don't override it in code with
`--extractor-args youtube:player_client=web`.

---

## Development

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Hot reload via `tsx watch` |
| `npm run build` | Compile to `dist/` via `tsc` |
| `npm run copy-assets` | Copy maker font assets + `data/` into `dist/` — only needed for a manual (non-Docker) production run; the Dockerfile copies the maker assets itself |
| `npm start` | Run `dist/server.js` |
| `npm test` | Run vitest |
| `npm run typecheck` | TypeScript check only |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, writes in place |

### Project layout

```
src/
├── server.ts
├── app.ts                    # buildApp() — registers plugins + routes
├── bootstrap.ts              # first-start master API key provisioning
├── config/env.ts             # zod-validated env loader
├── plugins/                  # cross-cutting Fastify plugins
│   ├── auth.ts
│   ├── errorHandler.ts
│   ├── quota.ts
│   ├── rateLimit.ts
│   ├── supabase.ts
│   └── swagger.ts
├── shared/
│   ├── errors.ts
│   ├── geminiRotator.ts      # Gemini API key rotation
│   ├── groqRotator.ts        # Groq API key rotation
│   ├── serpapiRotator.ts
│   ├── browser/
│   └── utils/                # lruCache, ssrfGuard, netscapeCookies
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
    │   ├── heru/             # AI chat (Groq)
    │   ├── imagegen/         # Image generation (Cloudflare Workers AI)
    │   ├── muslim/           # Islamic-knowledge AI assistant
    │   └── stt/              # Speech-to-text (Groq Whisper)
    ├── downloaders/
    │   ├── youtube/          # yt-dlp wrapper
    │   ├── tiktok/
    │   ├── instagram/
    │   ├── facebook/
    │   ├── twitter/
    │   ├── pinterest/
    │   ├── soundcloud/
    │   ├── spotify/
    │   ├── mediafire/
    │   └── _proxy/           # Signed streaming proxy
    ├── makers/
    │   ├── brat/
    │   ├── quote/
    │   ├── smeme/
    │   ├── miq/
    │   ├── iqc/
    │   ├── lq/
    │   ├── qc/
    │   └── vc/
    ├── fun/
    │   ├── cek-kodam/
    │   └── primbon/
    ├── games/                # Trivia, word games, and similar (Indonesian content)
    ├── search/
    │   ├── manga/
    │   └── pinterest/
    └── tools/
        ├── screenshot/
        ├── exif/
        ├── shortlinks/
        ├── tgsticker/
        ├── qr/
        ├── nsfw/
        ├── ocr/
        ├── translate/
        ├── tts/
        ├── iplookup/
        ├── removebg/
        ├── hitam/
        ├── anime/
        ├── memesticker/
        ├── randomsticker/
        └── tofigure/
python/
└── deezload/
    ├── deezload_service.py           # FastAPI service
    ├── requirements.txt
    ├── .env
    ├── .env.example
    ├── logs/                         # Runtime logs (gitignored)
    ├── venv/                         # Virtual environment (gitignored)
    ├── __pycache__/                  # Auto-generated (gitignored)
    ├── sesi_scraper.session          # Telegram session (generated, gitignored)
    └── sesi_scraper.session-journal  # SQLite journal (auto-generated)
tests/
supabase/schema.sql
supabase/migrations/
data/                         # MaxMind .mmdb files (gitignored)
```

### Conventions

- **Routes** — declare Zod schemas; Swagger docs are generated from them automatically. Route paths are mounted under a module-specific prefix in `src/app.ts` — check there for the canonical path, since a route file's own path comments can drift.
- **Services** — business logic, throw `AppError`.
- **Repositories** — the only layer that touches `app.supabase`.
- **Plugins** — use `fastify-plugin` (`fp`) so decorators are visible to the parent scope.
- **User-facing text is English.** Error messages, Swagger descriptions, and UI copy are all English so the API and dashboard are usable outside Indonesia. Code comments can be in either language. The one deliberate exception is `games/*` and `fun/*` content — those endpoints serve Indonesian-language trivia and novelty content by design, and translating the content itself would defeat their purpose.

### Errors

`AppError(statusCode, code, message, details?, userMessage?)` — `message` is
logged internally and never sent to the client; `userMessage` (if provided)
is what the caller actually sees. If you don't pass `userMessage`, the
caller gets a generic message for that status code (see
`defaultUserMessage` in `src/shared/errors.ts`). When a specific reason is
useful to the caller (e.g. "this slug is taken"), pass it explicitly as
`userMessage` — don't rely on `message` reaching them, because it won't.

---

## Tier policy

| Tier | Rate limit | Daily quota |
|---|---|---|
| Master key | None | Unlimited |
| User key (`dailyLimit: null`) | Per-endpoint | Unlimited |
| User key (numeric `dailyLimit`) | Per-endpoint | Enforced |
| Anonymous (no key) | Shared budget | `ANON_DAILY_QUOTA` per IP |
