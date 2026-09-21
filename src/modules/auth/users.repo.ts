import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '@shared/errors.js';

const TABLE = 'users';

/**
 * Escape a user-supplied search term for safe use inside a PostgREST
 * `ilike` filter value. PostgREST parses `,` `(` `)` as filter-grammar
 * separators, so an unescaped term lets an attacker inject extra filters
 * (e.g. against other columns) — especially dangerous here because the
 * service-role client bypasses RLS.
 *
 * The caller wraps the value in double quotes so `,` `(` `)` are treated
 * literally; this helper (a) drops LIKE/PostgREST wildcards so input matches
 * literally and (b) escapes the quoting characters so the term cannot break
 * out of the quoted value.
 */
function escapeSearchTerm(input: string): string {
  return input
    .slice(0, 100) // cap length
    .replace(/[%_*]/g, '') // neutralise LIKE / PostgREST wildcards
    .replace(/\\/g, '\\\\') // escape backslashes
    .replace(/"/g, '\\"'); // escape double quotes
}

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  /** Null for accounts that only sign in through a provider. */
  passwordHash: string | null;
  apiKeyId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** 'password' | 'google' | 'github' */
  provider: string;
  /** Stable subject id from the provider; null for password-only accounts. */
  providerId: string | null;
  /** Human name for greetings — from the provider, or null to fall back to username. */
  displayName: string | null;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  email: string;
  apiKeyId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  provider: string;
  /**
   * Whether a password is set. The dashboard needs this to know if key
   * reveal/rotate will work — both gates demand a password confirmation,
   * which a provider-only account cannot give.
   */
  hasPassword: boolean;
}

interface Row {
  id: string;
  username: string;
  email: string;
  password_hash: string | null;
  api_key_id: string | null;
  created_at: string;
  last_login_at: string | null;
  provider: string;
  provider_id: string | null;
  provider_linked_at: string | null;
  display_name: string | null;
}

const toRecord = (row: Row | null): UserRecord | null =>
  row && {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    apiKeyId: row.api_key_id,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    provider: row.provider,
    providerId: row.provider_id,
    displayName: row.display_name,
  };

export function usersRepo(db: SupabaseClient) {
  return {
    publicView(record: UserRecord): PublicUser {
      // providerId is an internal identity key — no reason to ship it.
      const { passwordHash, providerId: _p, ...rest } = record;
      return { ...rest, hasPassword: passwordHash !== null };
    },

    async findById(id: string): Promise<UserRecord | null> {
      const { data, error } = await db.from(TABLE).select('*').eq('id', id).maybeSingle<Row>();
      if (error) throw Internal(`users.findById: ${error.message}`);
      return toRecord(data);
    },

    async findByEmail(email: string): Promise<UserRecord | null> {
      const { data, error } = await db.from(TABLE).select('*').eq('email', email.toLowerCase()).maybeSingle<Row>();
      if (error) throw Internal(`users.findByEmail: ${error.message}`);
      return toRecord(data);
    },

    async findByUsername(username: string): Promise<UserRecord | null> {
      const { data, error } = await db.from(TABLE).select('*').eq('username', username.toLowerCase()).maybeSingle<Row>();
      if (error) throw Internal(`users.findByUsername: ${error.message}`);
      return toRecord(data);
    },

    async insert(rec: Omit<UserRecord, 'createdAt' | 'lastLoginAt'>): Promise<UserRecord> {
      const { data, error } = await db
        .from(TABLE)
        .insert({
          id: rec.id,
          username: rec.username,
          email: rec.email,
          password_hash: rec.passwordHash,
          api_key_id: rec.apiKeyId,
          provider: rec.provider,
          provider_id: rec.providerId,
          display_name: rec.displayName,
          provider_linked_at: rec.providerId ? new Date().toISOString() : null,
        })
        .select('*')
        .single<Row>();
      if (error || !data) throw Internal(`users.insert: ${error?.message ?? 'no data'}`);
      return toRecord(data)!;
    },

    /**
     * Find by provider identity. Preferred over email because the subject
     * id is stable even if the user later changes their provider email.
     */
    async findByProvider(provider: string, providerId: string): Promise<UserRecord | null> {
      const { data, error } = await db
        .from(TABLE)
        .select('*')
        .eq('provider', provider)
        .eq('provider_id', providerId)
        .maybeSingle<Row>();
      if (error) throw Internal(`users.findByProvider: ${error.message}`);
      return toRecord(data);
    },

    /**
     * Attach a provider identity to an account that already exists —
     * the password-user-signs-in-with-Google case. Leaves username,
     * api_key_id and history untouched.
     */
    async linkProvider(id: string, provider: string, providerId: string): Promise<void> {
      const { error } = await db
        .from(TABLE)
        .update({
          provider,
          provider_id: providerId,
          provider_linked_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw Internal(`users.linkProvider: ${error.message}`);
    },

    /** Set or replace the password hash. */
    async setPasswordHash(id: string, passwordHash: string): Promise<void> {
      const { error } = await db.from(TABLE).update({ password_hash: passwordHash }).eq('id', id);
      if (error) throw Internal(`users.setPasswordHash: ${error.message}`);
    },

    async remove(id: string): Promise<void> {
      const { error } = await db.from(TABLE).delete().eq('id', id);
      if (error) throw Internal(`users.remove: ${error.message}`);
    },

    async touchLogin(id: string): Promise<void> {
      const { error } = await db.from(TABLE).update({ last_login_at: new Date().toISOString() }).eq('id', id);
      if (error) throw Internal(`users.touchLogin: ${error.message}`);
    },

    async setApiKeyId(id: string, apiKeyId: string): Promise<void> {
      const { error } = await db.from(TABLE).update({ api_key_id: apiKeyId }).eq('id', id);
      if (error) throw Internal(`users.setApiKeyId: ${error.message}`);
    },

    async list(opts: { limit?: number; offset?: number; search?: string } = {}): Promise<{ users: PublicUser[]; total: number }> {
      const limit = Math.min(opts.limit ?? 50, 200);
      const offset = opts.offset ?? 0;

      let query = db
        .from(TABLE)
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (opts.search) {
        // ilike search on username or email. The term is escaped and the
        // value double-quoted so PostgREST filter metacharacters (, ( ) ")
        // cannot break out and inject additional filters.
        const term = escapeSearchTerm(opts.search);
        query = query.or(`username.ilike."%${term}%",email.ilike."%${term}%"`);
      }

      const { data, error, count } = await query;
      if (error) throw Internal(`users.list: ${error.message}`);
      const users = (data ?? []).map((r) => {
        const rec = toRecord(r as Row);
        return rec ? this.publicView(rec) : null;
      }).filter(Boolean) as PublicUser[];
      return { users, total: count ?? 0 };
    },
  };
}
