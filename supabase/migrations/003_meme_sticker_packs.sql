-- Meme sticker packs (Telegram sticker pack short-names) used by the
-- /api/tools/randomSticker random sticker endpoint.
-- Apply in Supabase SQL editor after 001_audit_log.sql and 002_muslim_ai_sessions.sql.

create table if not exists rexapi.meme_sticker_packs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,       -- Telegram pack short-name, e.g. "MemesIndonesia"
  label       text,                       -- optional human-readable label
  active      boolean not null default true,
  added_by    text,                       -- master/admin identifier, free text
  created_at  timestamptz not null default now()
);

create index if not exists meme_sticker_packs_active_idx
  on rexapi.meme_sticker_packs (active);

alter table rexapi.meme_sticker_packs enable row level security;
-- Service role only — no public policies, same convention as the rest of the schema.
