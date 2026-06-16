-- Muslim AI ("Ustadz AI") chat session storage.
-- Apply in Supabase SQL editor after 001_audit_log.sql.
--
-- Sessions hold a rolling chat history (JSON array of {role, content}).
-- TTL is enforced at the application layer (24h from last activity);
-- `expires_at` lets us also clean up stale rows with a periodic job
-- or rely on a Postgres cron extension if available.

create table if not exists rexapi.muslim_ai_sessions (
  id              text primary key,           -- user-supplied or randomly generated session id
  history         jsonb not null default '[]'::jsonb,
  owner_key_id    uuid,                        -- api_keys.id, null for anonymous
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  expires_at      timestamptz not null
);

create index if not exists muslim_ai_sessions_expires_at_idx
  on rexapi.muslim_ai_sessions (expires_at);
create index if not exists muslim_ai_sessions_owner_key_id_idx
  on rexapi.muslim_ai_sessions (owner_key_id);

alter table rexapi.muslim_ai_sessions enable row level security;
-- Service role only — no public policies, same convention as the rest of the schema.

-- ── RPC: upsert + refresh TTL atomically ──────────────────────────────────────
-- Avoids a read-then-write race when two requests touch the same session
-- concurrently. Caller passes the *full* updated history each time.
create or replace function rexapi.upsert_muslim_ai_session(
  p_id          text,
  p_history     jsonb,
  p_owner_key   uuid,
  p_ttl_seconds integer
)
returns rexapi.muslim_ai_sessions
language plpgsql
security definer
set search_path = rexapi, public, extensions
as $$
declare
  result rexapi.muslim_ai_sessions;
begin
  insert into rexapi.muslim_ai_sessions (id, history, owner_key_id, expires_at)
  values (p_id, p_history, p_owner_key, now() + (p_ttl_seconds || ' seconds')::interval)
  on conflict (id) do update
    set history    = excluded.history,
        updated_at = now(),
        expires_at = now() + (p_ttl_seconds || ' seconds')::interval
  returning * into result;

  return result;
end
$$;

-- ── Cleanup helper ───────────────────────────────────────────────────────────
-- Call periodically (e.g. via pg_cron or an external scheduler) to purge
-- expired sessions. Safe to call anytime; no-op if nothing is expired.
create or replace function rexapi.purge_expired_muslim_ai_sessions()
returns integer
language plpgsql
security definer
set search_path = rexapi, public, extensions
as $$
declare
  deleted_count integer;
begin
  delete from rexapi.muslim_ai_sessions where expires_at < now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end
$$;
