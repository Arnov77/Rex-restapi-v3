import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '../../shared/errors.js';

const TABLE = 'users';

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  passwordHash: string;
  apiKeyId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  apiKeyId: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface Row {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  api_key_id: string | null;
  created_at: string;
  last_login_at: string | null;
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
  };

export function usersRepo(db: SupabaseClient) {
  return {
    publicView(record: UserRecord): PublicUser {
      const { passwordHash: _h, ...rest } = record;
      return rest;
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
        })
        .select('*')
        .single<Row>();
      if (error || !data) throw Internal(`users.insert: ${error?.message ?? 'no data'}`);
      return toRecord(data)!;
    },

    async touchLogin(id: string): Promise<void> {
      const { error } = await db.from(TABLE).update({ last_login_at: new Date().toISOString() }).eq('id', id);
      if (error) throw Internal(`users.touchLogin: ${error.message}`);
    },

    async setApiKeyId(id: string, apiKeyId: string): Promise<void> {
      const { error } = await db.from(TABLE).update({ api_key_id: apiKeyId }).eq('id', id);
      if (error) throw Internal(`users.setApiKeyId: ${error.message}`);
    },
  };
}
