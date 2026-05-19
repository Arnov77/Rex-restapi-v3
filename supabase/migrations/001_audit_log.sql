-- Audit log for admin key management actions.
-- Apply in Supabase SQL editor after the base schema.sql.

create table if not exists rexapi.audit_log (
  id              uuid primary key default gen_random_uuid(),
  action          text not null,
  target_key_id   uuid not null,
  target_key_name text not null,
  actor_key_id    uuid not null,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);

-- Query pattern: newest first, optionally filtered by action or target.
create index if not exists audit_log_created_at_idx
  on rexapi.audit_log (created_at desc);
create index if not exists audit_log_target_key_id_idx
  on rexapi.audit_log (target_key_id);
create index if not exists audit_log_action_idx
  on rexapi.audit_log (action);

-- RLS enabled but no public policies — service role only.
alter table rexapi.audit_log enable row level security;
