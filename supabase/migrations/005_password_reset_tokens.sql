-- Single-use password reset tokens. Only the SHA-256 of the token is
-- stored: the raw value lives solely in the user's inbox, so a database
-- leak cannot be turned into account takeovers.
create table if not exists rexapi.password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references rexapi.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_idx
  on rexapi.password_reset_tokens (user_id);
