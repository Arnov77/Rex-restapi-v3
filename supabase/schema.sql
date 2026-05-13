-- Rex REST API — Supabase schema (relational, RPC-based quota).
--
-- Apply once in the Supabase SQL editor, then set on the server:
--   SUPABASE_URL=https://<project-ref>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
--
-- This schema lives in `rexapi` (not `public`) to keep the namespace clean
-- and isolated from anything else in the project. After applying:
--
--   Supabase Dashboard → Settings → API → "Exposed schemas"
--   → add `rexapi` to the comma-separated list (alongside `public`).
--
-- Without that step PostgREST (and supabase-js .from()/.rpc()) will return
-- 404/PGRST106 for any object in `rexapi`.
--
-- The Node server always connects with the service role, so RLS is enabled
-- (defence in depth) but no public policies are granted. Never expose the
-- service role key to client code.

-- ── Schema ───────────────────────────────────────────────────────────────────

create schema if not exists rexapi;
grant usage on schema rexapi to service_role, anon, authenticated;

-- pgcrypto (gen_random_uuid) lives in `extensions` on Supabase. Make sure
-- search_path can resolve it from inside our SECURITY DEFINER functions.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists rexapi.users (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique,
  email           text not null unique,
  password_hash   text not null,
  api_key_id      uuid,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);
create index if not exists users_api_key_id_idx on rexapi.users (api_key_id);

create table if not exists rexapi.api_keys (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  tier            text not null check (tier in ('user','master')),
  key_hash        text not null unique,
  key_encrypted   text,
  daily_limit     integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz,
  last_used_at    timestamptz,
  revoked         boolean not null default false,
  revoked_at      timestamptz
);
create index if not exists api_keys_key_hash_idx on rexapi.api_keys (key_hash);

-- One row per (date, counter_key). Date is the local-day bucket computed
-- by the server so the daily reset boundary lives in one place.
create table if not exists rexapi.usage_daily (
  bucket_date     date not null,
  counter_key     text not null,
  count           integer not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (bucket_date, counter_key)
);

-- ── RPC: atomic check + increment ────────────────────────────────────────────
--
-- Returns one row: (allowed boolean, used integer, limit_value integer).
--   * p_limit < 0  → unlimited (always allowed, just increments).
--   * p_limit >= 0 → only increments while count < p_limit; otherwise
--     `allowed=false` and `used` reflects the current value.
-- The conditional UPDATE is the atomic gate — two concurrent calls cannot
-- both push `count` past `p_limit`.
create or replace function rexapi.increment_usage(
  p_date    date,
  p_counter text,
  p_limit   integer
)
returns table(allowed boolean, used integer, limit_value integer)
language plpgsql
security definer
set search_path = rexapi, public, extensions
as $$
declare
  new_count integer;
begin
  insert into rexapi.usage_daily (bucket_date, counter_key, count)
  values (p_date, p_counter, 0)
  on conflict (bucket_date, counter_key) do nothing;

  if p_limit >= 0 then
    update rexapi.usage_daily
       set count = count + 1, updated_at = now()
     where bucket_date = p_date
       and counter_key = p_counter
       and count < p_limit
    returning count into new_count;

    if new_count is null then
      select count into new_count
        from rexapi.usage_daily
       where bucket_date = p_date and counter_key = p_counter;
      return query select false, coalesce(new_count, 0), p_limit;
      return;
    end if;
  else
    update rexapi.usage_daily
       set count = count + 1, updated_at = now()
     where bucket_date = p_date and counter_key = p_counter
    returning count into new_count;
  end if;

  return query select true, new_count, p_limit;
end
$$;

-- ── RPC: transfer counter (used when an API key is regenerated) ──────────────
create or replace function rexapi.transfer_usage(
  p_date date,
  p_from text,
  p_to   text
)
returns integer
language plpgsql
security definer
set search_path = rexapi, public, extensions
as $$
declare
  carry integer;
  merged integer;
begin
  if p_from = p_to then
    select count into carry from rexapi.usage_daily
     where bucket_date = p_date and counter_key = p_from;
    return coalesce(carry, 0);
  end if;

  select count into carry from rexapi.usage_daily
   where bucket_date = p_date and counter_key = p_from;

  if carry is null or carry = 0 then
    delete from rexapi.usage_daily
     where bucket_date = p_date and counter_key = p_from;
    select count into merged from rexapi.usage_daily
     where bucket_date = p_date and counter_key = p_to;
    return coalesce(merged, 0);
  end if;

  insert into rexapi.usage_daily (bucket_date, counter_key, count)
  values (p_date, p_to, carry)
  on conflict (bucket_date, counter_key)
    do update set count = rexapi.usage_daily.count + excluded.count,
                  updated_at = now()
  returning count into merged;

  delete from rexapi.usage_daily
   where bucket_date = p_date and counter_key = p_from;

  return merged;
end
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table rexapi.users enable row level security;
alter table rexapi.api_keys enable row level security;
alter table rexapi.usage_daily enable row level security;
-- No policies defined: only the service role (bypasses RLS) ever connects.

-- ── Rate limit (fixed window, persistent across instances) ───────────────────
create table if not exists rexapi.rate_limits (
  bucket_key   text not null,
  window_start timestamptz not null,
  count        integer not null default 0,
  primary key (bucket_key, window_start)
);
create index if not exists rate_limits_window_idx
  on rexapi.rate_limits (window_start);

-- Atomic check + increment. Returns (allowed, count, reset_at).
--   * Window is fixed-size: floor(epoch / p_window_s) * p_window_s.
--   * UPDATE is conditional on count < p_max — concurrent calls cannot both
--     push the counter past p_max.
drop function if exists rexapi.rate_limit_hit(text, integer, integer);
create or replace function rexapi.rate_limit_hit(
  p_key      text,
  p_window_s integer,
  p_max      integer
)
returns table(allowed boolean, count_out integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = rexapi, public, extensions
as $$
declare
  win_epoch bigint := (extract(epoch from now())::bigint / p_window_s) * p_window_s;
  win_start timestamptz := to_timestamp(win_epoch);
  cur integer;
begin
  insert into rexapi.rate_limits (bucket_key, window_start, count)
  values (p_key, win_start, 0)
  on conflict (bucket_key, window_start) do nothing;

  update rexapi.rate_limits rl
     set count = rl.count + 1
   where rl.bucket_key = p_key
     and rl.window_start = win_start
     and rl.count < p_max
  returning rl.count into cur;

  if cur is null then
    select rl.count into cur from rexapi.rate_limits rl
     where rl.bucket_key = p_key and rl.window_start = win_start;
    return query select false, coalesce(cur, 0), win_start + make_interval(secs => p_window_s);
    return;
  end if;
  return query select true, cur, win_start + make_interval(secs => p_window_s);
end
$$;

-- Garbage-collect expired windows. Call periodically from the app.
create or replace function rexapi.rate_limit_gc(p_older_than interval)
returns integer
language plpgsql
security definer
set search_path = rexapi, public, extensions
as $$
declare n integer;
begin
  delete from rexapi.rate_limits where window_start < now() - p_older_than;
  get diagnostics n = row_count;
  return n;
end
$$;

alter table rexapi.rate_limits enable row level security;

-- ── Grants for service role (RLS-bypassing app role) ─────────────────────────
grant all on all tables    in schema rexapi to service_role;
grant all on all sequences in schema rexapi to service_role;
grant all on all routines  in schema rexapi to service_role;

alter default privileges in schema rexapi
  grant all on tables    to service_role;
alter default privileges in schema rexapi
  grant all on sequences to service_role;
alter default privileges in schema rexapi
  grant all on routines  to service_role;
