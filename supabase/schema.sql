-- Rex REST API — Supabase schema (relational, RPC-based quota).
--
-- Apply once in the Supabase SQL editor, then set on the server:
--   SUPABASE_URL=https://<project-ref>.supabase.co
--   SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
--
-- The Node server always connects with the service role, so RLS is enabled
-- (defence in depth) but no public policies are granted. Never expose the
-- service role key to client code.

-- ── Tables ───────────────────────────────────────────────────────────────────

create table if not exists public.rex_users (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique,
  email           text not null unique,
  password_hash   text not null,
  api_key_id      uuid,
  created_at      timestamptz not null default now(),
  last_login_at   timestamptz
);
create index if not exists rex_users_api_key_id_idx on public.rex_users (api_key_id);

create table if not exists public.rex_api_keys (
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
create index if not exists rex_api_keys_key_hash_idx on public.rex_api_keys (key_hash);

-- One row per (date, counter_key). Date is the local-day bucket computed
-- by the server so the daily reset boundary lives in one place.
create table if not exists public.rex_usage_daily (
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
create or replace function public.rex_increment_usage(
  p_date    date,
  p_counter text,
  p_limit   integer
)
returns table(allowed boolean, used integer, limit_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  new_count integer;
begin
  insert into public.rex_usage_daily (bucket_date, counter_key, count)
  values (p_date, p_counter, 0)
  on conflict (bucket_date, counter_key) do nothing;

  if p_limit >= 0 then
    update public.rex_usage_daily
       set count = count + 1, updated_at = now()
     where bucket_date = p_date
       and counter_key = p_counter
       and count < p_limit
    returning count into new_count;

    if new_count is null then
      select count into new_count
        from public.rex_usage_daily
       where bucket_date = p_date and counter_key = p_counter;
      return query select false, coalesce(new_count, 0), p_limit;
      return;
    end if;
  else
    update public.rex_usage_daily
       set count = count + 1, updated_at = now()
     where bucket_date = p_date and counter_key = p_counter
    returning count into new_count;
  end if;

  return query select true, new_count, p_limit;
end
$$;

-- ── RPC: transfer counter (used when an API key is regenerated) ──────────────
create or replace function public.rex_transfer_usage(
  p_date date,
  p_from text,
  p_to   text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  carry integer;
  merged integer;
begin
  if p_from = p_to then
    select count into carry from public.rex_usage_daily
     where bucket_date = p_date and counter_key = p_from;
    return coalesce(carry, 0);
  end if;

  select count into carry from public.rex_usage_daily
   where bucket_date = p_date and counter_key = p_from;

  if carry is null or carry = 0 then
    delete from public.rex_usage_daily
     where bucket_date = p_date and counter_key = p_from;
    select count into merged from public.rex_usage_daily
     where bucket_date = p_date and counter_key = p_to;
    return coalesce(merged, 0);
  end if;

  insert into public.rex_usage_daily (bucket_date, counter_key, count)
  values (p_date, p_to, carry)
  on conflict (bucket_date, counter_key)
    do update set count = rex_usage_daily.count + excluded.count,
                  updated_at = now()
  returning count into merged;

  delete from public.rex_usage_daily
   where bucket_date = p_date and counter_key = p_from;

  return merged;
end
$$;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.rex_users enable row level security;
alter table public.rex_api_keys enable row level security;
alter table public.rex_usage_daily enable row level security;
-- No policies defined: only the service role (bypasses RLS) ever connects.
