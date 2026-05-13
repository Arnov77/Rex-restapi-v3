# Refactor: Async Stores, Layering, Persisted Rate Limiter, Tests

## Tujuan

1. Hilangkan in-memory cache di `usersStore` & `apiKeyStore` → murni async ke Supabase, multi-instance ready.
2. Pisahkan layer jadi **repository** (DB-only) + **service** (business logic) + **controller** (HTTP).
3. Pindahkan rate limiter login & register ke Supabase (persisten, multi-instance safe).
4. Aktifkan kembali test suite dengan mock `@supabase/supabase-js`.

## Arsitektur Baru

```text
src/shared/auth/
  supabaseClient.js                  (tetap)
  apiKeyAuth.js                      (jadi async)
  verifyToken.js                     (jadi async)
  jwt.js                             (tetap)

src/shared/repositories/             (BARU — pure DB access)
  users.repo.js                      get/find/insert/update by Supabase
  apiKeys.repo.js
  usage.repo.js                      (eks usageStore)
  rateLimit.repo.js                  (BARU — counter sliding window)

src/core/auth/                       (service + controller terpisah)
  auth.service.js                    (BARU — register/login business logic)
  auth.controller.js                 (HTTP only, panggil service)
  apiKeys.service.js                 (BARU — create/rotate/revoke + crypto)

src/shared/middleware/
  dailyQuota.js                      (panggil usage.repo)
  loginLimiter.js                    (pakai rateLimit.repo, bukan in-memory)
  registerLimiter.js                 (pakai rateLimit.repo)
```

**Aturan import**: controller → service → repository → supabaseClient. Tidak ada lompat layer.

## Perubahan Schema

Tambah satu tabel + RPC untuk rate limiter sliding window:

```sql
create table public.rex_rate_limits (
  bucket_key   text not null,        -- "login-ip:1.2.3.4" / "login-id:user@x"
  window_start timestamptz not null, -- awal window
  count        integer not null default 0,
  primary key (bucket_key, window_start)
);
create index on public.rex_rate_limits (bucket_key, window_start desc);

-- RPC: atomic check + increment dengan sliding window
create or replace function public.rex_rate_limit_hit(
  p_key      text,
  p_window_s integer,    -- panjang window (detik)
  p_max      integer
) returns table(allowed boolean, count integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  win_start timestamptz := date_trunc('second', now()) - make_interval(secs => extract(epoch from now())::int % p_window_s);
  cur integer;
begin
  insert into public.rex_rate_limits (bucket_key, window_start, count)
  values (p_key, win_start, 0)
  on conflict (bucket_key, window_start) do nothing;

  update public.rex_rate_limits
     set count = count + 1
   where bucket_key = p_key and window_start = win_start and count < p_max
   returning count into cur;

  if cur is null then
    select count into cur from public.rex_rate_limits
     where bucket_key = p_key and window_start = win_start;
    return query select false, cur, win_start + make_interval(secs => p_window_s);
  end if;
  return query select true, cur, win_start + make_interval(secs => p_window_s);
end$$;

-- Cleanup harian (cron-friendly, dipanggil dari Node interval)
create or replace function public.rex_rate_limit_gc(p_older_than interval)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.rex_rate_limits where window_start < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end$$;
```

## Dampak Sync→Async (semua jadi `await`)

Repository semua async. Pemanggil yang harus diubah:

- `apiKeyAuth.js` → `async apiKeyAuth(req,res,next)`, `await verifyKey(...)`, `await touchKey(...)` (best-effort, non-blocking).
- `verifyToken.js` → `async`, `await usersRepo.findById(...)`.
- `dailyQuota.js` → sudah async, ganti panggilan `apiKeyStore.findById` & `usersStore.findByApiKeyId` ke `await`.
- `auth.controller.js`, `user.controller.js`, `admin.controller.js` → semua `findBy*` jadi `await`. Hapus semua `persistNow()` (write langsung await di service).

`touchKey` (last-used update) tetap fire-and-forget di middleware — gagal di sini tidak boleh blok request.

## Rencana Eksekusi (Bertahap)

### Fase 1 — Schema & repository layer (BARU)

1. Update `supabase/schema.sql`: tambah `rex_rate_limits`, RPC `rex_rate_limit_hit` & `rex_rate_limit_gc`.
2. Buat `src/shared/repositories/`:
   - `users.repo.js` — semua method async, no cache.
   - `apiKeys.repo.js` — async, no cache. Crypto helpers tetap di sini (atau pindah ke `apiKeys.service.js`).
   - `usage.repo.js` — pindahkan dari `usageStore.js` (tipis, sudah RPC).
   - `rateLimit.repo.js` — `hit(key, windowSec, max)` & `gc(olderThan)`.

### Fase 2 — Service layer (BARU)

3. `src/core/auth/auth.service.js`: `register({email, username, password})`, `login({identifier, password})` — pindah business logic dari controller.
4. `src/core/auth/apiKeys.service.js`: `createForUser`, `rotateForUser`, `revokeForUser`, `getPlaintext` — bungkus crypto + repo + transaksi (hapus old key + buat baru + transfer usage).

### Fase 3 — Wire controllers

5. Refactor `auth.controller.js`, `user.controller.js`, `admin.controller.js` → tipis, hanya parse req + panggil service + format response. Hapus `persistNow()`.
6. Refactor `apiKeyAuth.js` & `verifyToken.js` jadi async.
7. Update `dailyQuota.js` ke repo baru (await).

### Fase 4 — Rate limiter ke Supabase

8. Buat custom express middleware `supabaseRateLimit({ key, windowSec, max, message })` di `src/shared/middleware/supabaseRateLimit.js` — internal pakai `rateLimit.repo.hit`. Set header `RateLimit-*` standar.
9. Rewrite `loginLimiter.js` & `registerLimiter.js` → dua middleware (IP + identifier untuk login, IP untuk register) pakai `supabaseRateLimit`.
10. Tambah interval GC di `server.js` startup: `setInterval(() => rateLimit.repo.gc('1 day'), 60*60*1000).unref()`.

### Fase 5 — Cleanup `server.js`

11. Hapus `usersStore.init()`, `apiKeyStore.init()`, `flushPendingTouches()` dari startup/shutdown — tidak ada cache lagi. Pertahankan `apiKeyStore.ensureMasterKey()` (sekarang jadi `apiKeysService.ensureMaster()`).
12. Hapus file lama: `src/shared/auth/usersStore.js`, `apiKeyStore.js`, `usageStore.js` (digantikan repository + service).

### Fase 6 — Tests

13. Buat `tests/_helpers/supabaseMock.js` — in-memory mock dari `@supabase/supabase-js` chain (`from().select().eq().maybeSingle()`, `insert`, `update`, `rpc`). Cukup sederhana untuk semua suite.
14. Setup `vi.mock('@supabase/supabase-js', ...)` di tiap test file yang butuh.
15. Aktifkan kembali (hapus `.skip`) dan rewrite:
    - `tests/users-store.test.js` → `tests/users-repo.test.js`
    - `tests/api-key-store.test.js` → `tests/api-keys-repo.test.js`
    - `tests/usage-store.test.js` → `tests/usage-repo.test.js`
    - `tests/daily-quota.test.js`
    - `tests/api-key-auth.test.js`
    - `tests/auth-routes.test.js`
    - `tests/admin-routes.test.js`
    - `tests/reveal-key.test.js`
    - `tests/login-limiter.test.js` & `tests/register-limiter.test.js` → mock RPC `rex_rate_limit_hit`.

## File yang Diubah / Dibuat / Dihapus

**Baru**:
- `src/shared/repositories/{users,apiKeys,usage,rateLimit}.repo.js`
- `src/core/auth/{auth,apiKeys}.service.js`
- `src/shared/middleware/supabaseRateLimit.js`
- `tests/_helpers/supabaseMock.js`

**Diubah**:
- `supabase/schema.sql` (tambah tabel + 2 RPC)
- `server.js`, `dailyQuota.js`, `apiKeyAuth.js`, `verifyToken.js`
- `auth.controller.js`, `user.controller.js`, `admin.controller.js`
- `loginLimiter.js`, `registerLimiter.js`
- Semua test (10 file) — un-skip + rewrite

**Dihapus**:
- `src/shared/auth/usersStore.js`
- `src/shared/auth/apiKeyStore.js`
- `src/shared/auth/usageStore.js`

## Catatan / Trade-offs

- **Latency**: setiap request kena 1–2 round-trip Supabase tambahan (sebelumnya cache hit). Untuk skala saat ini (single user) tidak masalah; jika nanti perlu, bisa tambah cache LRU per-instance dengan TTL pendek di repo layer.
- **Failure mode**: rate limiter Supabase fail → default fail-open (log warn, izinkan request) supaya outage DB tidak 5xx semua login. Daily quota sudah pakai pola yang sama.
- **Master key bootstrap**: `ensureMasterKey()` jalan di startup, butuh DB up. OK karena server tetap perlu DB untuk fungsi inti.

## Setelah Merge (di VPS)

1. Jalankan SQL baru (tabel `rex_rate_limits` + 2 RPC) di Supabase SQL editor.
2. `git pull && npm install` (tidak ada dep baru).
3. Restart server.
