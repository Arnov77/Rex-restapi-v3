-- Rex REST API auth persistence tables.
-- Run this in the Supabase SQL editor, then set:
-- AUTH_STORE_BACKEND=supabase
-- SUPABASE_URL=https://<project-ref>.supabase.co
-- SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

create table if not exists public.rex_users (
  id uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rex_api_keys (
  id uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.rex_usage (
  date text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.rex_users enable row level security;
alter table public.rex_api_keys enable row level security;
alter table public.rex_usage enable row level security;

-- No public RLS policies are needed. The server uses SUPABASE_SERVICE_ROLE_KEY,
-- which bypasses RLS. Never expose that key to browser/client code.
