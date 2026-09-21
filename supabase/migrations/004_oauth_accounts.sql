-- OAuth sign-in (Google, GitHub) alongside the existing password flow.
--
-- Accounts are keyed by email: signing in with a provider that reports a
-- verified address reuses the existing row, so a user who registered with
-- a password keeps their username, API key and history. Only a genuinely
-- new email creates a row.

-- Provider accounts have no password of their own.
alter table rexapi.users
  alter column password_hash drop not null;

-- How the account can be signed into. 'password' for everything that
-- exists today; a row can carry both once a password user links a provider.
alter table rexapi.users
  add column if not exists provider text not null default 'password',
  add column if not exists provider_id text,
  add column if not exists provider_linked_at timestamptz;

-- One provider identity maps to at most one account.
create unique index if not exists users_provider_identity_key
  on rexapi.users (provider, provider_id)
  where provider_id is not null;

-- Guard against a row that can be signed into no way at all.
alter table rexapi.users
  add constraint users_has_credential
  check (password_hash is not null or provider_id is not null);

comment on column rexapi.users.provider is
  'password | google | github — how this account was created';
comment on column rexapi.users.provider_id is
  'Stable subject id from the provider; null for password-only accounts';
