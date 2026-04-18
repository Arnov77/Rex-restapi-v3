# Rex-RESTAPI

REST API untuk downloader media, generator gambar, dan utilitas tambahan dengan struktur v2 yang sudah dipisah ke `core`, `shared`, dan route utilitas yang masih aktif.

## Endpoint aktif

- `POST /api/youtube/mp3`
- `POST /api/youtube/mp4`
- `POST /api/tiktok/download`
- `POST /api/tiktok/audio`
- `POST /api/instagram/download`
- `POST /api/brat/image`
- `POST /api/brat/video`
- `GET|POST /api/gdrive`
- `GET|POST /api/quote`
- `GET|POST /api/smeme`
- `GET|POST /api/promosi`
- `POST /api/miq/generate`
- `GET /health`
- `GET /api/status`
- `GET /mcapi/*`

Endpoint compatibility lama yang dipakai saat migrasi sudah dibersihkan dari codebase.

## Struktur proyek

```text
Rex-RESTAPI
|- public/
|- src/
|  |- core/
|  |  |- ai/gemini/
|  |  `- media/
|  |     |- brat/
|  |     |- instagram/
|  |     |- tiktok/
|  |     `- youtube/
|  |  `- tools/
|  |     |- gdrive/
|  |     |- mcprofile/
|  |     |- miq/
|  |     |- promosi/
|  |     |- quote/
|  |     `- smeme/
|  |- shared/
|  `- utils/
|- package.json
`- server.js
```

## Menjalankan aplikasi

```bash
npm install
node server.js
```

Minimal `.env`:

```env
PORT=7860
GEMINI_API_KEY=your_gemini_api_key
DISCORD_WEBHOOK_URL=your_discord_webhook_url
```

`DISCORD_WEBHOOK_URL` dipakai oleh endpoint MIQ jika client mengirim file `avatar`. File akan di-upload dulu ke Discord webhook untuk mendapatkan URL CDN yang diterima oleh upstream MIQ.

## Contoh request

```bash
curl -X POST http://localhost:7860/api/youtube/mp3 ^
  -H "Content-Type: application/json" ^
  -d "{\"query\":\"never gonna give you up\"}""

```
