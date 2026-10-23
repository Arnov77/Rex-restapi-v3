-- H4 fix: invalidate access JWTs when the password changes.
--
-- Auth middleware rejects any access token whose `iat` (issued-at) predates
-- this stamp, so a stolen token dies the moment the victim changes their
-- password, sets their first password, or completes a password reset.
-- Rows that never rotated a password keep NULL and are unaffected.
alter table rexapi.users
  add column if not exists password_changed_at timestamptz;
