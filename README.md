# Rex-RESTAPI

REST API untuk downloader media (YouTube / TikTok / Instagram / Twitter / Pinterest), generator gambar (Brat / MIQ / quote / smeme), TTS WhatsApp voice note, sticker Telegram → WhatsApp, dan utilitas tambahan. Sistem **membership** sendiri (akun + JWT + API key + quota harian per-user) tanpa upstream auth provider.

Struktur v2: kode dipecah ke `src/core/` (per-domain), `src/shared/` (cross-cutting), test suite Vitest, lint/format pipeline (eslint + prettier + husky).

---

## Membership system

Tiap request ke `/api/*` (kecuali `/api/auth/*` dan `/api/user/*`) wajib lewat **dailyQuota** middleware. Tier user ditentukan dari header `X-API-Key`:

| Tier   | Cara identifikasi                                | Quota default | Tracking key    |
| ------ | ------------------------------------------------ | ------------- | --------------- |
| Anon   | Tidak ada `X-API-Key` (atau key invalid)         | 30 / hari     | `anon:<ipHash>` |
| User   | `X-API-Key: rex_...` valid, milik user terdaftar | 250 / hari    | `user:<userId>` |
| Master | `X-API-Key` cocok dengan `MASTER_API_KEY`        | bypass        | tidak di-track  |

Anon quota dibagi rata se-IP (semua IP yang sama berbagi 30 hits). User quota privat per akun — **regenerate key TIDAK reset quota** (counter ikut user, bukan key). Reset terjadi tiap tengah malam waktu server.

### Anti-abuse layering

| Guard            | Scope              | Window   | Default cap   | Env override                            |
| ---------------- | ------------------ | -------- | ------------- | --------------------------------------- |
| Anti-spam burst  | Per IP, all routes | 1 detik  | 5 req         | `ANTI_SPAM_PER_SECOND`                  |
| Login limiter    | Per IP             | 15 menit | 10 attempts   | `LOGIN_LIMIT_PER_IP`                    |
| Login limiter    | Per username/email | 15 menit | 5 attempts    | `LOGIN_LIMIT_PER_IDENTIFIER`            |
| Register limiter | Per IP             | 1 jam    | 5 attempts    | `REGISTER_LIMIT_PER_IP`                 |
| Daily quota      | Per user/anon      | 24 jam   | 30 / 250 hits | `QUOTA_ANON_DAILY` / `QUOTA_USER_DAILY` |

Login limiter sukses **tidak** konsumsi budget (bukan brute-force). Register limiter mencatat sukses + gagal (mencegah signup spam).

### Auth endpoints (`/api/auth`)

| Method | Path                 | Body                            | Returns                                    |
| ------ | -------------------- | ------------------------------- | ------------------------------------------ |
| `POST` | `/api/auth/register` | `{ username, email, password }` | User + plaintext API key + JWT (Bearer 7d) |
| `POST` | `/api/auth/login`    | `{ identifier, password }`      | User + plaintext API key + JWT             |

**Password policy**: minimal 10 karakter, harus mengandung minimal 1 huruf dan 1 angka. Hashed dengan bcrypt (`BCRYPT_ROUNDS`, default 10).

### User endpoints (`/api/user`, JWT required)

| Method | Path                       | Body           | Returns                                              |
| ------ | -------------------------- | -------------- | ---------------------------------------------------- |
| `GET`  | `/api/user/profile`        | —              | User + API key metadata (`key: null`) + usage live   |
| `POST` | `/api/user/regenerate-key` | —              | API key baru (plaintext). Key lama langsung invalid. |
| `POST` | `/api/user/reveal-key`     | `{ password }` | API key plaintext. Bcrypt-verified.                  |

**Threat model**: `/profile` dipanggil tiap 30 detik oleh dashboard untuk live quota. Plaintext API key tidak dikirim di response /profile — kalau JWT bocor, attacker tidak otomatis dapat API key. Plaintext cuma dikirim di event yang fresh-auth (register, login, regenerate, reveal). Frontend cache plaintext di `localStorage` → kalau cache kosong, user wajib reveal manual dengan password.

### Admin endpoints (`/api/admin`, master key required)

Mounted tapi **disembunyikan dari Swagger publik** (`/api/docs.json` tidak tampilkan `/api/admin/*` paths atau tag `Admin`). Endpoint tetap fungsional dan di-gate `requireMaster` middleware (header `X-API-Key: <MASTER>`).

| Method   | Path                  | Fungsi                                           |
| -------- | --------------------- | ------------------------------------------------ |
| `GET`    | `/api/admin/keys`     | List semua API key                               |
| `POST`   | `/api/admin/keys`     | Buat key manual (tier, quota, name, owner)       |
| `PATCH`  | `/api/admin/keys/:id` | Edit metadata / quota / tier                     |
| `DELETE` | `/api/admin/keys/:id` | Revoke key                                       |
| `GET`    | `/api/admin/usage`    | Lihat usage per scope (`user:`, `key:`, `anon:`) |

**Master key**: dibaca dari env `MASTER_API_KEY`. Kalau env kosong, server auto-generate plaintext + simpan ke `data/master-key.txt` (chmod 0600) saat boot pertama. Pesan log warn akan muncul dengan path file. Move ke env untuk deploy multi-instance.

---

## Endpoint media & utility

| Method      | Path                                  | Catatan                                                   |
| ----------- | ------------------------------------- | --------------------------------------------------------- |
| `POST`      | `/api/youtube/mp3`                    | Audio MP3 dari URL atau judul                             |
| `POST`      | `/api/youtube/mp4`                    | Video MP4 + opsi `quality` (lihat di bawah)               |
| `POST`      | `/api/tiktok/download`                | Video TikTok (no watermark)                               |
| `POST`      | `/api/tiktok/audio`                   | Audio TikTok                                              |
| `POST`      | `/api/instagram/download`             | Video / reel / post Instagram                             |
| `POST`      | `/api/twitter/download`               | Video / foto Twitter / X (3-tier fallback)                |
| `POST`      | `/api/pinterest/download`             | Foto / video Pinterest (auto-upgrade ke `/originals/`)    |
| `POST`      | `/api/tts/google`                     | Voice note ogg/opus PTT WhatsApp (16kHz mono 32kbps)      |
| `GET\|POST` | `/api/gdrive`                         | Resolver direct-download Google Drive                     |
| `POST`      | `/api/brat/image`                     | Generator gambar style "Brat"                             |
| `POST`      | `/api/brat/video`                     | Versi animasi GIF                                         |
| `POST`      | `/api/quote`, `/api/smeme`            | Generator gambar template                                 |
| `POST`      | `/api/miq/generate`                   | "Make It a Quote" (avatar opsional via Discord webhook)   |
| `POST`      | `/api/promosi`                        | Promotion detector (Gemini)                               |
| `POST`      | `/api/telegram/sticker-pack`          | Info isi Telegram sticker pack                            |
| `POST`      | `/api/telegram/sticker-pack/download` | Convert seluruh pack ke `.wasticker` siap import WhatsApp |
| `POST`      | `/api/telegram/sticker`               | Convert 1 sticker (static / animated)                     |
| `GET`       | `/mcapi/profile`                      | Minecraft Java/Bedrock profile (username, XUID, UUID)     |
| `GET`       | `/mcapi/render/head`                  | Render kepala Minecraft dari skin URL / username          |
| `GET`       | `/health`, `/api/status`              | Probe                                                     |
| `GET`       | `/api/docs`                           | Swagger UI live                                           |

## YouTube downloader

Engine YouTube punya **fallback 3-tier** supaya tahan terhadap perubahan server-side YouTube:

1. **Tier 1 — `youtubei.js`** (primary). Generate PO Token otomatis lewat `bgutils-js` BotGuard challenge in-process, tidak butuh PO Token manual. Coba beberapa client (TV → IOS → WEB_EMBEDDED → MWEB → ANDROID_VR → WEB) sampai dapat format yang playable. Decipher signature/n-param via custom JS evaluator.
2. **Tier 2 — `@distube/ytdl-core`** (fallback 1). Pakai cookies user untuk auth, agent dibuat dari Netscape cookie file.
3. **Tier 3 — `yt-dlp`** (fallback 2). Last resort, runtime binary, format selector `bestvideo[height<=N]+bestaudio/best[height<=N]/bestvideo+bestaudio/best`.

Tier yang berhasil pertama menang. Tier 1+2 download per-format pakai **chunked range request** (~10MB per chunk, video+audio paralel) untuk bypass adaptive throttling YouTube.

### Parameter `quality` (MP4)

Opsional, default `best`. Nilai yang valid:

```
144 | 240 | 360 | 480 | 720 | 1080 | 1440 | 2160 | best
```

Nilai numerik diperlakukan sebagai **height ceiling** (bukan exact match). Server akan pilih resolusi tertinggi yang `<= cap`. Kalau resolusi yang diminta tidak tersedia (mis. video aslinya cuma 720p tapi user minta 1080p), server **tidak error** — tetap return video dengan resolusi tertinggi yang ada.

YouTube cuma publish format muxed (video+audio dalam 1 file) sampai 360p. Untuk 480p ke atas, server otomatis pakai jalur adaptive (download video + audio terpisah, lalu merge via ffmpeg).

### Storage `downloads/`

Endpoint MP3/MP4 menyimpan file di `downloads/` dan return URL `${baseUrl}/downloads/<file>`. File auto-dihapus ketika lebih tua dari TTL (default 1 jam). Sweep dijalankan saat server boot dan setiap N menit.

---

## Menjalankan aplikasi

### Quick start

```bash
npm install
npm start          # atau: node server.js
```

Server listen di `PORT` (default 7860). Kalau `JWT_SECRET` & `MASTER_API_KEY` belum di-set, server auto-generate keduanya saat boot pertama dan tulis ke `data/jwt-secret.txt` + `data/master-key.txt` (chmod 0600). Pesan warn akan muncul di log.

### Membership flow (manual / curl)

```bash
# 1. Register — dapat plaintext key + JWT
curl -X POST http://localhost:7860/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","email":"alice@example.com","password":"hunter22pass"}'
# → { data: { user, apiKey: { key: "rex_...", ... }, token } }

# 2. Pakai key untuk hit endpoint biasa
curl -H 'X-API-Key: rex_...' \
  -X POST http://localhost:7860/api/quote \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice","message":"halo"}'

# 3. Cek profile + quota live
curl http://localhost:7860/api/user/profile \
  -H 'Authorization: Bearer <JWT>'
# → apiKey.key === null (tidak leak); usage.user.daily.used = N

# 4. Reveal plaintext key (kalau cache localStorage hilang)
curl -X POST http://localhost:7860/api/user/reveal-key \
  -H 'Authorization: Bearer <JWT>' \
  -H 'Content-Type: application/json' \
  -d '{"password":"hunter22pass"}'
# → { data: { apiKey: { key: "rex_...", ... } } }

# 5. Regenerate key (kalau bocor). Quota TIDAK reset.
curl -X POST http://localhost:7860/api/user/regenerate-key \
  -H 'Authorization: Bearer <JWT>'
```

Atau pakai dashboard di `/` (landing page) — modal Daftar / Login otomatis simpan JWT + plaintext key ke `localStorage`, dashboard `/profile` view live.

### Minimal `.env`

Cukup ini untuk jalan dasar (semua key auth auto-generate):

```env
PORT=7860
NODE_ENV=development
```

Untuk production, MINIMAL set ini supaya restart tidak invalidate JWT existing + multi-instance pakai master key sama:

```env
JWT_SECRET=<64-byte random hex>
MASTER_API_KEY=rex_<43-char base64url>
```

Tambahkan upstream tokens hanya kalau pakai endpoint terkait (`GEMINI_API_KEY` untuk `/api/promosi`, `DISCORD_WEBHOOK_URL` untuk MIQ avatar upload, `TELEGRAM_BOT_TOKEN` untuk `/api/telegram/*`). Lihat [`.env.example`](./.env.example) untuk daftar lengkap dengan default.

### YouTube cookies (opsional, untuk video age-restricted / region-locked)

Letakkan file Netscape cookie di salah satu lokasi di bawah ini (dicek berurutan):

```
./cookies.txt            # repo-relative
./.cookies.txt
$HOME/.cookies/youtube.txt
```

Isi file: hasil export plugin "Get cookies.txt" dari browser yang sudah login YouTube. Kalau tidak ada cookies, video publik tetap berjalan via Tier 1 (PO Token auto-generated cukup untuk gate auth).

---

## Struktur proyek

```text
Rex-RESTAPI/
├── data/                  # Persistent state (users, api-keys, usage, secrets) — chmod 0600
├── downloads/             # Hasil MP3/MP4 download, auto-sweep TTL
├── public/                # Landing page + dashboard frontend
├── src/
│   ├── core/
│   │   ├── auth/          # /api/auth — register, login
│   │   ├── user/          # /api/user — profile, regenerate, reveal
│   │   ├── admin/         # /api/admin — key management (master gated)
│   │   ├── media/         # youtube, tiktok, instagram, twitter, pinterest, brat, telegram, ...
│   │   └── tools/         # gdrive, mcprofile, miq, promosi, quote, smeme, tts
│   └── shared/            # logger, errors, middleware (apiKeyAuth, dailyQuota, antiSpam, *Limiter), stores, swagger, ...
├── tests/                 # Vitest suite
├── server.js
└── package.json
```

## Development

```bash
npm run lint        # eslint
npm run format      # prettier
npm test            # vitest (sekali jalan)
npm run test:watch  # mode watch
```

Pre-commit hook (husky + lint-staged) sudah ke-set, akan run lint + format pada file yang di-stage.

## API Docs (Swagger)

Live di `GET /api/docs` saat server jalan. Spec digenerate dari JSDoc `@openapi` block di tiap routes file. Endpoint admin **tidak ditampilkan** di spec publik (di-strip sebelum di-export).
