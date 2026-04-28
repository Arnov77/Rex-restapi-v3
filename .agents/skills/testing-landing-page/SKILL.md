# Testing the Rex-RESTAPI landing page (Try-It UI)

This skill covers smoke-testing the public landing page at `/` and its Try-It modal.
It does **not** cover unit tests (`npm test` already runs 38 vitest specs).

## Boot

```bash
cd $REPO_ROOT
npm install --no-audit --no-fund   # idempotent — husky/prepare wires hooks
NODE_ENV=development PORT=7860 node server.js
```

No secrets are required to boot — `config.js` makes every upstream token optional.
Server listens on `7860`. Health check: `curl http://localhost:7860/health` returns `{success:true,...,"healthy"}`.

## Endpoints worth knowing

- `/` — landing page (HTML + `public/data/apis.json` + `public/js/script.js`).
- `/api/docs` — Swagger UI (redirects to `/api/docs/`).
- `/api/docs.json` — raw OpenAPI spec.
- `/api/telegram/sticker-pack/download` — POST. Empty body → `400 {success:false, message:"Sediakan url atau packName."}`. Heavy tier rate limit (10/min/IP).
- `/api/smeme` — POST. Canvas-based, **no Playwright dependency** — use this when verifying the image-preview branch on a dev VM that lacks Chromium.

## Rate limit tiers (`src/shared/middleware/rateLimiter.js`)

- `generalLimiter`: 300 / 15 min
- `apiLimiter`: 30 / min
- `heavyLimiter`: 10 / min — applies to brat/quote/youtube/telegram/sticker-pack/download. Easy to trip when manually clicking Try-It rapidly.
- `aiLimiter`: 10 / hour

The limiter sets `Retry-After` and the frontend appends `Coba lagi dalam <N> detik.` to the error message — this is verifiable end-to-end by spamming any heavy endpoint 11+ times within a minute.

## How the frontend handles responses

See `public/js/script.js`'s `handleApiResponse(response, opts)` dispatcher:

1. If `!response.ok` → `showApiError(status, headers, payload)` — extracts `payload.message` from the JSON envelope (or maps HTTP status to a friendly Indonesian copy if missing). Honors `Retry-After` for 429.
2. If `Content-Type` includes `application/octet-stream`, `application/zip`, or the call is `/api/telegram/sticker-pack/download` → `triggerDownload(blob, filename)` with filename from `Content-Disposition`.
3. If `Content-Type` starts with `image/` → `showImage()` renders inline `<img>` + `Download <ext>` anchor.
4. JSON → `showJSON()`.

When testing error rendering, the adversarial check is **"is the panel showing the verbatim envelope `message` and not raw JSON / `[object Object]` / 'Response tidak dikenali'?"**.

## Env gotchas

- **Chromium not installed on bare dev VMs**: `/api/brat/image`, `/api/brat/video`, `/api/quote`, `/api/miq/generate` all rely on Playwright + Chromium and will return `500 Failed to generate <X>` with no Chromium present. Check `which chromium`, `which google-chrome`, `~/.cache/ms-playwright` to confirm. Workaround when verifying the image-preview branch: use `/api/smeme` (server-side `node-canvas`) which works without Playwright.
- **`CHROME_BIN` auto-detect** in `config.js` scans `/snap/bin/chromium` → `/usr/bin/chromium` → `chromium-browser` → `google-chrome` → `google-chrome-stable`. Set `CHROME_BIN=/path/to/chromium` to override.
- **`/api/docs` redirects to `/api/docs/`** (301). Asserting on a non-trailing-slash URL will fail; follow the redirect.

## Try-It UI — adversarial test playbook

1. **Sidebar count match**: `apis.json` length per category should match the count badge. A regression that drops/duplicates an entry surfaces here first.
2. **Form fields = Joi schema**: open the Try-It modal, enumerate every input id (`f-<fieldName>`), compare against the schema in `src/core/<domain>/<feature>/<feature>.schemas.js`. Mismatch = drift.
3. **Empty-body POST → envelope rendering**: any endpoint with required fields will echo a deterministic Joi message that you can grep for (e.g. `Sediakan url atau packName.` for sticker-pack download). Asserting on the _parsed_ message (not the raw JSON) distinguishes the new dispatcher from the old.
4. **Spam to trip rate limit**: 12 rapid clicks on any heavy endpoint should produce `429 Error` + the Indonesian Retry-After tail.
5. **Code tab matches data**: the cURL/fetch/axios/Python snippets are generated from `apis.json#action`. If a rename was missed, the snippet will still show the old path. Read the snippet, do not trust the title alone.

## Telegram-pack download — what's testable without secrets

- Form rendering, validation, and error envelope: yes.
- Real `.wasticker` archive download: needs `TELEGRAM_BOT_TOKEN` + a stable public pack. Skip in dev unless you have both.

## Devin Secrets Needed

- `TELEGRAM_BOT_TOKEN` (optional) — only if you want to exercise a real sticker-pack download end-to-end.
- This upstream token is optional at boot; the server starts cleanly without it and the corresponding endpoint fails with 503 until configured.

## Linters / formatters / tests

```bash
npm run lint          # 0 errors expected
npm run format:check  # writes nothing
npm test              # vitest, 38+ specs
```

Pre-commit hook runs `lint-staged` automatically — staged files are auto-formatted before commit.
