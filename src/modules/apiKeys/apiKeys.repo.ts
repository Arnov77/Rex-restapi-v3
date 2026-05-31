import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '@shared/errors.js';

const TABLE = 'api_keys';

export type Tier = 'user' | 'master';

export interface ApiKeyRecord {
  id: string;
  name: string;
  tier: Tier;
  keyHash: string;
  keyEncrypted: string | null;
  dailyLimit: number | null;
  createdAt: string;
  updatedAt: string | null;
  lastUsedAt: string | null;
  revoked: boolean;
  revokedAt: string | null;
}

interface Row {
  id: string;
  name: string;
  tier: Tier;
  key_hash: string;
  key_encrypted: string | null;
  daily_limit: number | null;
  created_at: string;
  updated_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
  revoked_at: string | null;
}

const toRecord = (r: Row | null): ApiKeyRecord | null =>
  r && {
    id: r.id,
    name: r.name,
    tier: r.tier,
    keyHash: r.key_hash,
    keyEncrypted: r.key_encrypted,
    dailyLimit: r.daily_limit,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastUsedAt: r.last_used_at,
    revoked: r.revoked,
    revokedAt: r.revoked_at,
  };

export interface InsertInput {
  id: string;
  name: string;
  tier: Tier;
  keyHash: string;
  keyEncrypted: string | null;
  dailyLimit: number | null;
}

export function apiKeysRepo(db: SupabaseClient) {
  return {
    publicView(rec: ApiKeyRecord): Omit<ApiKeyRecord, 'keyHash' | 'keyEncrypted'> {
      const { keyHash: _h, keyEncrypted: _e, ...rest } = rec;
      return rest;
    },

    async findById(id: string): Promise<ApiKeyRecord | null> {
      const { data, error } = await db.from(TABLE).select('*').eq('id', id).maybeSingle<Row>();
      if (error) throw Internal(`apiKeys.findById: ${error.message}`);
      return toRecord(data);
    },

    async findByHash(hash: string): Promise<ApiKeyRecord | null> {
      const { data, error } = await db.from(TABLE).select('*').eq('key_hash', hash).maybeSingle<Row>();
      if (error) throw Internal(`apiKeys.findByHash: ${error.message}`);
      return toRecord(data);
    },

    async list(opts: { includeRevoked?: boolean } = {}): Promise<ApiKeyRecord[]> {
      let q = db.from(TABLE).select('*').order('created_at', { ascending: false });
      if (!opts.includeRevoked) q = q.eq('revoked', false);
      const { data, error } = await q;
      if (error) throw Internal(`apiKeys.list: ${error.message}`);
      return (data ?? []).map((r) => toRecord(r as Row)!).filter(Boolean);
    },

    async listMasters(): Promise<ApiKeyRecord[]> {
      const { data, error } = await db
        .from(TABLE)
        .select('*')
        .eq('tier', 'master')
        .eq('revoked', false);
      if (error) throw Internal(`apiKeys.listMasters: ${error.message}`);
      return (data ?? []).map((r) => toRecord(r as Row)!).filter(Boolean);
    },

    async insert(input: InsertInput): Promise<ApiKeyRecord> {
      const { data, error } = await db
        .from(TABLE)
        .insert({
          id: input.id,
          name: input.name,
          tier: input.tier,
          key_hash: input.keyHash,
          key_encrypted: input.keyEncrypted,
          daily_limit: input.dailyLimit,
        })
        .select('*')
        .single<Row>();
      if (error || !data) throw Internal(`apiKeys.insert: ${error?.message ?? 'no data'}`);
      return toRecord(data)!;
    },

    async revoke(id: string): Promise<void> {
      const { error } = await db
        .from(TABLE)
        .update({ revoked: true, revoked_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw Internal(`apiKeys.revoke: ${error.message}`);
    },

    async activate(id: string): Promise<ApiKeyRecord> {
      const { data, error } = await db
        .from(TABLE)
        .update({ revoked: false, revoked_at: null, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single<Row>();
      if (error || !data) throw Internal(`apiKeys.activate: ${error?.message ?? 'no data'}`);
      return toRecord(data)!;
    },

    /**
     * Patch a key's mutable fields. Only `name` and `dailyLimit` are
     * exposed today — tier/hash/revoked are managed by dedicated paths.
     * Pass `dailyLimit: null` for "unlimited" (the schema column is nullable).
     */
    async update(
      id: string,
      patch: { name?: string; dailyLimit?: number | null },
    ): Promise<ApiKeyRecord> {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.name !== undefined) row.name = patch.name;
      if (patch.dailyLimit !== undefined) row.daily_limit = patch.dailyLimit;
      const { data, error } = await db
        .from(TABLE)
        .update(row)
        .eq('id', id)
        .select('*')
        .single<Row>();
      if (error || !data) throw Internal(`apiKeys.update: ${error?.message ?? 'no data'}`);
      return toRecord(data)!;
    },

    /**
     * Replace the hash/encrypted blob in-place. Used by regenerate so the
     * key id stays the same — dependent rows (users.api_key_id, daily
     * usage carry-over) don't need to migrate.
     */
    async rotateHash(
      id: string,
      keyHash: string,
      keyEncrypted: string | null,
    ): Promise<ApiKeyRecord> {
      const { data, error } = await db
        .from(TABLE)
        .update({
          key_hash: keyHash,
          key_encrypted: keyEncrypted,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single<Row>();
      if (error || !data) throw Internal(`apiKeys.rotateHash: ${error?.message ?? 'no data'}`);
      return toRecord(data)!;
    },

    async touch(id: string): Promise<void> {
      const { error } = await db.from(TABLE).update({ last_used_at: new Date().toISOString() }).eq('id', id);
      if (error) throw Internal(`apiKeys.touch: ${error.message}`);
    },
  };
}
