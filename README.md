# Rex-RESTAPI

REST API untuk downloader media (YouTube / TikTok / Instagram), generator gambar (Brat / MIQ / quote), dan utilitas tambahan. Struktur v2: kode dipecah ke `src/core/` (per-domain), `src/shared/` (cross-cutting), dan ada test suite Vitest + lint/format pipeline.

## Endpoint aktif

| Method      | Path                       | Catatan                                         |
| ----------- | -------------------------- | ----------------------------------------------- |
| `POST`      | `/api/youtube/mp3`         | Audio MP3 dari URL atau judul                   |
| `POST`      | `/api/youtube/mp4`         | Video MP4 + opsi `quality` (lihat di bawah)     |
| `POST`      | `/api/tiktok/download`     | Video TikTok (no watermark)                     |
| `POST`      | `/api/tiktok/audio`        | Audio TikTok                                    |
| `POST`      | `/api/instagram/download`  | Video / reel / post Instagram                   |
| `POST`      | `/api/brat/image`          | Generator gambar style "Brat"                   |
| `POST`      | `/api/brat/video`          | Versi animasi                                   |
| `GET\|POST` | `/api/gdrive`              | Resolver direct-download Google Drive           |
| `GET\|POST` | `/api/quote`, `/api/smeme` | Generator gambar template                       |
| `GET\|POST` | `/api/promosi`             | Generator banner promosi                        |
| `POST`      | `/api/miq/generate`        | "Make It a Quote" (avatar opsional via Discord) |
| `GET`       | `/health`, `/api/status`   | Probe                                           |
| `GET`       | `/mcapi/*`                 | Minecraft server status proxy                   |
| `GET`       | `/api/docs`                | Swagger UI live                                 |

Endpoint compatibility lama yang sempat dipakai saat migrasi sudah dibersihkan dari codebase.

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

Contoh request:

```bash
# JSON body
curl -X POST http://localhost:7860/api/youtube/mp4 \
  -H "Content-Type: application/json" \
  -d '{"query":"never gonna give you up","quality":"1080"}'

# Query string
curl "http://localhost:7860/api/youtube/mp4?query=never+gonna&quality=720"
```

Contoh response:

```json
{
  "status": "success",
  "data": {
    "title": "...",
    "download": "http://localhost:7860/downloads/<uid>-<title>.mp4",
    "format": "video/mp4",
    "resolution": "1080p",
    "fileSize": "42.13 MB",
    "duration": "03:32",
    "author": "...",
    "thumbnail": "...",
    "status": "success"
  },
  "message": "MP4 download link generated"
}
```

Field `resolution` di-probe dari file akhir lewat `ffprobe`, jadi mencerminkan resolusi yang **benar-benar di-download** (bukan yang diminta).

### Storage `downloads/`

Endpoint MP3/MP4 menyimpan file di `downloads/` dan return URL `${baseUrl}/downloads/<file>`. File auto-dihapus ketika lebih tua dari TTL (default 1 jam). Sweep dijalankan saat server boot dan setiap N menit.

Configurable via `.env`:

```env
DOWNLOADS_TTL_MIN=60      # default 1 jam
DOWNLOADS_SWEEP_MIN=5     # default 5 menit
```

## Struktur proyek

```text
Rex-RESTAPI/
├── public/                # Landing page + frontend assets
├── src/
│   ├── core/
│   │   ├── ai/replicate/
│   │   ├── media/
│   │   │   ├── brat/
│   │   │   ├── instagram/
│   │   │   ├── tiktok/
│   │   │   └── youtube/   # service + 3 helper (youtubei, ytdl-core, yt-dlp)
│   │   └── tools/
│   │       ├── gdrive/
│   │       ├── mcprofile/
│   │       ├── miq/
│   │       ├── promosi/
│   │       ├── quote/
│   │       └── smeme/
│   └── shared/            # logger, errors, cookies, downloadsCleanup, swagger, ...
├── tests/                 # Vitest suite (64+ tests)
├── server.js
└── package.json
```

## Menjalankan aplikasi

```bash
npm install
npm start          # atau: node server.js
```

### Minimal `.env`

```env
PORT=7860
GEMINI_API_KEY=your_gemini_api_key      # untuk endpoint AI
DISCORD_WEBHOOK_URL=...                 # opsional, dipakai MIQ kalau client kirim file avatar
```

`DISCORD_WEBHOOK_URL` dipakai endpoint MIQ ketika client mengirim file `avatar`. File akan di-upload dulu ke Discord webhook untuk dapat URL CDN yang diterima oleh upstream MIQ.

### YouTube cookies (opsional, untuk video age-restricted / region-locked)

Letakkan file Netscape cookie di salah satu lokasi di bawah ini (dicek berurutan):

```
./cookies.txt            # repo-relative
./.cookies.txt
$HOME/.cookies/youtube.txt
```

Isi file: hasil export plugin "Get cookies.txt" dari browser yang sudah login YouTube. Kalau tidak ada cookies, video publik tetap berjalan via Tier 1 (PO Token auto-generated cukup untuk gate auth).

## Development

```bash
npm run lint        # eslint
npm run format      # prettier
npm test            # vitest (sekali jalan)
npm run test:watch  # mode watch
```

Pre-commit hook (husky + lint-staged) sudah ke-set, akan run lint + format pada file yang di-stage.

## API Docs (Swagger)

Live di `GET /api/docs` saat server jalan. Spec digenerate dari JSDoc `@openapi` block di tiap routes file.

## Contoh request lain

```bash
# MP3
curl -X POST http://localhost:7860/api/youtube/mp3 \
  -H "Content-Type: application/json" \
  -d '{"query":"never gonna give you up"}'

# TikTok
curl -X POST http://localhost:7860/api/tiktok/download \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@.../video/..."}'

# Brat image
curl -X POST http://localhost:7860/api/brat/image \
  -H "Content-Type: application/json" \
  -d '{"text":"hello world"}' --output brat.png
```
