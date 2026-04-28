# Test Plan — PR #23 Phase 4.5 Frontend Auth UI

## What changed

Frontend-only PR adding register/login modal, profile panel (in-page SPA view), API key click-to-show / click-to-copy, regenerate key with quota carry-over, sidebar auth slot that swaps anon ↔ authed UI, toast system, 30s polling, and auto-injection of `X-API-Key` into the "Coba Langsung" tab. No backend changes.

## Code references

- Sidebar auth slot: `public/js/script.js:1400-1430` (`renderSidebarAuth`)
- Auth modal forms: `public/js/script.js:1450-1570` (`openAuthModal`, `submitLogin`, `submitRegister`)
- Profile rendering: `public/js/script.js:1590-1730` (`showProfileView`, `refreshProfile`, `renderProfile`)
- Auto-inject `X-API-Key`: `public/js/script.js:~1081` (`sendReq` headers)
- Logout: `public/js/script.js:1573-1585` (`doLogout`)
- HTML scaffolding: `public/index.html` (authSlot, toastContainer, authOverlay)

## Primary E2E flow (one continuous recording)

### Setup state

- Fresh `data/users.json` (empty / non-existent)
- Server boot at `http://localhost:7860`

### Test 1 — Register creates account, auto-shows profile, key/quota visible

**Actions:**

1. Open `http://localhost:7860/`
2. Click **Daftar** in sidebar
3. Fill: username `alice`, email `alice@example.com`, password `hunter22pass`
4. Click **Daftar Akun**

**Pass criteria (each verifiable):**

- Sidebar swaps to authed userbox showing `alice` (initial "A" avatar) — would NOT happen if session not stored
- Main content swaps to profile view with title "Profile"
- Profile card shows username `alice`, email `alice@example.com`
- API key card shows masked value matching pattern `rex_••••...` (NOT plaintext) — would fail if mask logic broken
- Quota card shows `0 / 1000` exact — would fail if backend not returning correct quota
- Toast appears top-right with text containing "selamat datang alice"

### Test 2 — Show / Copy / Auto-inject and quota updates live

**Actions:**

1. On profile, click **Show** button on API key
2. Click **Copy** button
3. Click **Endpoints** > "Quote API" (or any cheap endpoint) in sidebar
4. Open the endpoint, switch to **Coba Langsung** tab
5. Inspect Headers section → confirm `X-API-Key` field is pre-filled with the user's key
6. Submit the request
7. Click **Profile** in sidebar
8. Click manual refresh (or wait — but to keep recording short, click sidebar Profile to retrigger fetch)

**Pass criteria:**

- After **Show**: api key text changes from `rex_••...` mask to full plaintext starting with `rex_` and length ~36 chars — would fail if toggle broken
- After **Copy**: toast "API key disalin" appears; clipboard contains the key (verify by paste into form input as proof)
- In Coba Langsung, X-API-Key field value starts with `rex_` and matches the user's key — would fail if auto-inject not wired
- After endpoint hit + return to profile, quota number changes from `0` to `1` (or higher) — would fail if quota endpoint not refreshing or auto-inject not actually using the key

### Test 3 — Regenerate key preserves quota (anti-abuse from PR #22)

**Actions:**

1. Note current API key value (last 6 chars) and current quota `used` value
2. Click **Regenerate Key** in API Key card
3. Confirm the JS confirm() dialog
4. Profile re-renders

**Pass criteria:**

- New API key shows different value (last 6 chars differ) — would fail if regenerate didn't actually change key
- Quota `used` value is **same or higher** than before regenerate (NOT reset to 0) — critical anti-abuse assertion; would fail if usageStore.transfer broken
- Toast "Key berhasil diregenerasi"

### Test 4 — Logout returns to anon, login by username works

**Actions:**

1. Click **Logout** in sidebar
2. Sidebar reverts to Daftar/Login
3. Click **Login**
4. In identifier field, type `alice` (USERNAME, not email — covers email-or-username login path)
5. Type password `hunter22pass`
6. Submit

**Pass criteria:**

- After logout: sidebar shows Daftar + Login buttons; main content reverts to default — would fail if state not cleared
- After login: profile auto-shows again with same data (same email `alice@example.com`, quota persists from earlier hits) — would fail if username-login path broken or session restore broken

## Regression skip

Skipping mobile viewport, polling tick observation (30s wait too slow for video), and 401 expiry simulation (would require manipulating localStorage). These are nice-to-haves; primary correctness covered above.

## Out of scope

- Password reset flow (Phase 5)
- Email verification (Phase 5)
- Backend regression tests (already covered by 144 vitest specs that pass in CI)
