# Rex API — v3 (Fastify + TypeScript)

REST API untuk aplikasi, bot WhatsApp, dan automation tools. Repository-Service-Routes layering, Supabase sebagai persistence layer, Swagger docs di `/docs`.

## Quick Start

```bash
cp env.example .env
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

---

## Server Setup (Fresh Deploy)

### 1. System Dependencies

```bash
apt update && apt install -y \
  nodejs ffmpeg deno \
  python3.11 python3.11-venv curl git
```

> **Node.js v22+** disarankan. Cek dengan `node --version`.

### 2. yt-dlp

Install yt-dlp via pip Python 3.11 (harus sama dengan Python yang dipakai):

```bash
# Install pip untuk Python 3.11
curl -sS https://bootstrap.pypa.io/get-pip.py | python3.11

# Install yt-dlp
python3.11 -m pip install yt-dlp

# Install bgutil plugin (PO Token provider untuk YouTube)
python3.11 -m pip install bgutil-ytdlp-pot-provider

# Verifikasi
yt-dlp --version
which yt-dlp   # harus /usr/local/bin/yt-dlp
head -1 $(which yt-dlp)  # harus #!/usr/bin/python3.11
```

### 3. DeezLoad (Spotify Downloader)

Rex API menggunakan integrasi **DeezLoad** untuk mengunduh lagu Spotify melalui Telegram Userbot. Seluruh environment Python menggunakan **Python 3.11**.

Masuk ke folder DeezLoad:

```bash
cd /root/rex-api/python/deezload
```

Buat virtual environment:

```bash
python3.11 -m venv venv
```

Aktifkan virtual environment:

```bash
source venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Setelah selesai:

```bash
deactivate
```

> **Catatan:** Jalankan DeezLoad menggunakan virtual environment tersebut agar dependency tidak bercampur dengan instalasi Python sistem.

### 4. Telegram API Setup

DeezLoad menggunakan Telegram Userbot sehingga membutuhkan **API ID** dan **API Hash**.

Cara mendapatkannya:

1. Login ke https://my.telegram.org
2. Pilih **API Development Tools**
3. Buat aplikasi baru.
4. Salin:
   - API ID
   - API Hash

Isi file `.env` pada folder `python/deezload`:

```env
TG_API_ID=
TG_API_HASH=
```

### 5. Generate Telegram Session

Sebelum menjalankan DeezLoad sebagai service, session Telegram harus dibuat terlebih dahulu.

Masuk ke folder DeezLoad dan aktifkan virtual environment:

```bash
cd /root/rex-api/python/deezload
source venv/bin/activate
```

Jalankan service secara manual:

```bash
uvicorn deezload_service:app --host 127.0.0.1 --port 8001
```

Saat pertama kali dijalankan, Telethon akan meminta login ke akun Telegram.

Masukkan:

- Nomor telepon
- Kode verifikasi (OTP)
- Password 2FA (jika ada)

Setelah login berhasil, file berikut akan dibuat otomatis:

```
sesi_scraper.session
```

Tekan `Ctrl + C` untuk menghentikan service setelah session berhasil dibuat.

> File `sesi_scraper.session` berisi autentikasi Telegram Userbot. Jangan dihapus atau dibagikan kepada siapa pun.

> Jangan membagikan API Hash kepada siapa pun.

### 6. bgutil Docker (YouTube PO Token)

YouTube membutuhkan PO Token yang valid untuk bypass bot detection. Jalankan bgutil sebagai Docker container:

```bash
docker run -d \
  --name bgutil-provider \
  --restart unless-stopped \
  -p 4416:4416 \
  brainicism/bgutil-ytdlp-pot-provider
```

Verifikasi server jalan:

```bash
curl -X POST http://127.0.0.1:4416/get_pot \
  -H "Content-Type: application/json" \
  -d '{"videoId": "dQw4w9WgXcQ", "clientName": "WEB"}'
# Harus return JSON dengan poToken terisi
```

### 7. yt-dlp Config

Buat config global yt-dlp supaya semua flag aktif otomatis:

```bash
mkdir -p ~/.config/yt-dlp
cat > ~/.config/yt-dlp/config << 'EOF'
--extractor-args "youtube:po_token=web+fetch_pot"
--extractor-args "youtube:getpot_bgutil_url=http://127.0.0.1:4416"
--js-runtimes node
--remote-components ejs:github
EOF
```

> **Kenapa perlu ini semua?**
> - `po_token=web+fetch_pot` — perintahkan yt-dlp untuk fetch PO Token via bgutil
> - `getpot_bgutil_url` — arahkan ke bgutil Docker yang jalan di port 4416
> - `--js-runtimes node` — aktifkan Node.js sebagai JS runtime (defaultnya hanya Deno)
> - `--remote-components ejs:github` — download JS challenge solver script dari GitHub (cached setelah pertama kali)

> **Catatan Node.js:** yt-dlp mencari binary bernama `node`, tapi di beberapa distro binary-nya bernama `nodejs`. Buat symlink jika perlu:
> ```bash
> ln -sf /usr/bin/nodejs /usr/local/bin/node
> # atau
> ln -sf /usr/bin/node /usr/local/bin/node
> ```

### 8. YouTube Cookies

IP server VPS biasanya kena flag YouTube dan perlu cookies untuk bypass. Export cookies dari browser yang sudah login YouTube:

1. Install extension **"Get cookies.txt LOCALLY"** di Chrome/Firefox
2. Buka `youtube.com` → pastikan sudah login
3. Klik extension → Export cookies untuk `youtube.com`
4. Upload ke server:

```bash
scp cookies.txt root@<server-ip>:/root/rex-api/cookies.txt
```

Set path di `.env`:

```env
YTDLP_COOKIES_PATH=./cookies.txt
```

> **Tips:** Refresh cookies setiap 2–4 minggu. Pakai akun Google yang aktif dipakai (bukan akun baru/kosong) agar lebih tahan lama.

### 9. Proxy (Opsional tapi Disarankan)

Jika IP server sudah kena flag YouTube (muncul captcha/bot error), tambahkan proxy HTTP:

```env
YTDLP_PROXY_URL=http://username:password@ip:port
```

Cek proxy yang bekerja dengan yt-dlp:

```bash
yt-dlp --proxy "http://user:pass@ip:port" \
  --cookies /root/rex-api/cookies.txt \
  "ytsearch1:test" --list-formats
```

Format audio/video harus muncul (bukan cuma storyboard).

### 10. Test yt-dlp End-to-End

```bash
yt-dlp --cookies /root/rex-api/cookies.txt \
  "ytsearch1:despacito" --list-formats
```

Output yang benar akan menampilkan format seperti `140 m4a audio only`, `137 mp4 1920x1080`, dsb. Jika hanya muncul `sb0/sb1/sb2 mhtml storyboard`, ada masalah di cookies atau bgutil.

---

## Docker

```bash
docker build -t rex-api .
docker run --rm -p 3000:3000 --env-file .env rex-api
```

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Hot reload via `tsx watch` |
| `npm run build` | Compile ke `dist/` via `tsc` + copy assets |
| `npm start` | Jalankan `dist/server.js` |
| `npm test` | Run vitest |
| `npm run typecheck` | TypeScript check only |

---

## Project Layout

```
src/
├── server.ts
├── app.ts                    # buildApp() — register plugins + routes
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
    │   ├── muslim/           # Muslim AI assistant
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
    ├── games/                # Tebak-tebakan, asah otak, dll
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

---

## Environment Variables

Lihat `env.example` untuk dokumentasi lengkap. Variabel penting:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | ✅ | Min 32 chars |
| `API_KEY_ENC_KEY` | ✅ | 64 hex chars (`openssl rand -hex 32`) |
| `SUPABASE_URL` | ✅ | |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | |
| `MASTER_API_KEY_BOOTSTRAP` | First run | Format: `rex_<base64url>` |
| `YTDLP_COOKIES_PATH` | YouTube | Path ke cookies.txt (Netscape format) |
| `YTDLP_PROXY_URL` | YouTube | `http://user:pass@ip:port` — pakai jika IP server kena flag |
| `GEMINI_API_KEYS` | OCR | Comma-separated |
| `HF_TOKENS` | Skin filter, to-anime, to-figure | Comma-separated, dari huggingface.co/settings/tokens |
| `REMOVEBG_API_KEY` | Remove bg & change bg (proof.bg) | API key dari proof.bg |
| `GROQ_API_KEYS` | STT, Translate, Imagegen | Comma-separated |
| `CF_WORKER_URL` | Imagegen | URL Cloudflare Worker |
| `CF_WORKER_API_KEY` | Imagegen | |
| `GEOIP_CITY_DB` | IP Lookup | Path ke GeoLite2-City.mmdb |
| `GEOIP_ASN_DB` | IP Lookup | Path ke GeoLite2-ASN.mmdb |
| `COBALT_API_URL` | Downloaders | Default: public instance |

---

## External Dependencies

| Service | Dipakai untuk |
|---|---|
| **Supabase** | Database & auth |
| **Groq** | Whisper STT, translate, imagegen prompt, AI chat |
| **Gemini** | OCR (ekstrak teks dari gambar) |
| **Hugging Face** | Skin filter, to-anime, to-figure (AI image transformation) |
| **proof.bg** | Remove background & change background gambar |
| **Cloudflare Workers AI** | Image generation (self-deployed worker) |
| **MaxMind GeoLite2** | IP geolocation (offline .mmdb, download manual) |
| **Cobalt** | Media downloader (self-host disarankan) |
| **yt-dlp** | YouTube downloader (+ bgutil Docker untuk PO Token) |
| **Playwright/Chromium** | Screenshot, render image |
| **ffmpeg** | Audio/video processing, loudness normalization |
| **Deno** | JS runtime untuk yt-dlp challenge solver (fallback) |

---

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
| `/api/download/soundcloud` | GET | Download SoundCloud audio |
| `/api/download/spotify` | GET | Download Spotify (via yt-dlp search) |
| `/api/download/mediafire` | GET | Download MediaFire file |
| `/api/download/twitter` | GET | Download Twitter/X video |

### Makers
| Path | Method | Notes |
|---|---|---|
| `/api/brat` | GET | Generate brat-style image |
| `/api/quote` | GET | Generate quote card |
| `/api/smeme` | GET | Generate stiker meme |
| `/api/miq` | GET | Maker IQ card |
| `/api/iqc` | GET | IQ certificate |
| `/api/qc` | GET | Quote card |
| `/api/lq` | GET | Lyric quote card |
| `/api/vc` | GET | Voice card |

### Tools
| Path | Method | Notes |
|---|---|---|
| `/api/screenshot` | GET | Screenshot halaman web |
| `/api/exif` | POST | Extract EXIF metadata dari gambar |
| `/api/shortlinks` | GET/POST/DELETE | URL shortener |
| `/api/qr` | GET | Generate QR code (PNG/SVG) |
| `/api/translate` | GET | Translate teks (Groq LLM) |
| `/api/tts` | GET | Text-to-speech |
| `/api/ocr` | POST | OCR dari gambar |
| `/api/iplookup` | GET | IP geolocation lookup |
| `/api/removebg` | POST | Remove background gambar |
| `/api/tgsticker` | POST | Convert ke Telegram sticker |

### AI
| Path | Method | Notes |
|---|---|---|
| `/api/ai/imagegen` | GET | Generate gambar dari prompt |
| `/api/ai/stt` | POST | Speech-to-text via Groq Whisper |
| `/api/ai/heru` | POST | AI chat assistant |
| `/api/ai/muslim` | POST | Muslim AI assistant |

---

## Database

Jalankan `supabase/schema.sql` sekali di Supabase SQL editor. Setelah itu apply migrations secara berurutan:

```bash
# Di Supabase SQL editor, jalankan satu per satu:
supabase/migrations/001_audit_log.sql
supabase/migrations/002_muslim_ai_sessions.sql
supabase/migrations/003_meme_sticker_packs.sql
```

---

## Bootstrap (First Run)

Generate master key dulu:

```bash
node -e "console.log('rex_' + require('crypto').randomBytes(32).toString('base64url'))"
```

Set di `.env`:

```env
MASTER_API_KEY_BOOTSTRAP=rex_xxxxxxxxxxxx
```

Start server. Setelah log `"provisioned master API key"` muncul, **hapus** `MASTER_API_KEY_BOOTSTRAP` dari `.env` dan restart.

---

## Tier Policy

| Tier | Rate limit | Daily quota |
|---|---|---|
| master key | none | unlimited |
| user key (`dailyLimit: null`) | per-endpoint | unlimited |
| user key (numeric `dailyLimit`) | per-endpoint | enforced |
| anon (no key) | base budget | `ANON_DAILY_QUOTA` per IP |

---

## Conventions

- **Routes** — declare Zod schemas; Swagger auto-generate docs
- **Services** — business logic, throw `AppError`
- **Repositories** — satu-satunya yang akses `app.supabase`
- **Plugins** — pakai `fastify-plugin` (`fp`) agar decorators leak ke parent scope

---

## Troubleshooting yt-dlp

### Hanya muncul storyboard (sb0/sb1/sb2), tidak ada format audio/video

Cek secara berurutan:

1. **bgutil jalan?**
   ```bash
   curl -X POST http://127.0.0.1:4416/get_pot \
     -H "Content-Type: application/json" \
     -d '{"videoId": "dQw4w9WgXcQ", "clientName": "WEB"}'
   ```
   Harus return `poToken` yang terisi.

2. **Config yt-dlp sudah ada?**
   ```bash
   cat ~/.config/yt-dlp/config
   ```
   Harus ada 4 baris (po_token, getpot_bgutil_url, js-runtimes, remote-components).

3. **Node.js terdeteksi yt-dlp?**
   ```bash
   yt-dlp -v "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --simulate 2>&1 | grep "JS runtimes"
   # Harus muncul: [debug] JS runtimes: deno-x.x.x, node-xx.xx.x
   ```
   Jika node tidak muncul: `ln -sf /usr/bin/nodejs /usr/local/bin/node`

4. **Cookies masih valid?**
   ```bash
   yt-dlp --cookies /root/rex-api/cookies.txt \
     "https://www.youtube.com/feed/subscriptions" --simulate 2>&1 | grep -i "account\|login"
   ```
   Harus muncul `Found YouTube account cookies`. Jika tidak, export ulang cookies dari browser.

5. **IP server kena flag?**
   ```bash
   yt-dlp --cookies /root/rex-api/cookies.txt "ytsearch1:test" --list-formats 2>&1 | grep -i "captcha\|bot\|sign in"
   ```
   Jika muncul error captcha/bot, set `YTDLP_PROXY_URL` di `.env`.

### `Signature solving failed`

Download remote components:

```bash
yt-dlp --remote-components ejs:github \
  --cookies /root/rex-api/cookies.txt \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --list-formats
```

Pastikan `--remote-components ejs:github` ada di `~/.config/yt-dlp/config`.

### YouTube forcing SABR streaming

Jangan pakai `player_client=web`. Biarkan config `~/.config/yt-dlp/config` yang handle — jangan override di kode dengan `--extractor-args youtube:player_client=web`.
