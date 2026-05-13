import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { apiKeysRepo, type ApiKeyRecord, type Tier } from './apiKeys.repo.js';
import { decryptApiKey, encryptApiKey, generatePlaintextKey, hashApiKey } from './apiKeys.crypto.js';
import { NotFound } from '../../shared/errors.js';

export interface CreateInput {
  name: string;
  tier: Tier;
  dailyLimit?: number | null;
  /** When provided, encrypt the plaintext for later reveal (master keys). */
  storeEncrypted?: boolean;
  /** Override the generated key — used by the bootstrap path. */
  plaintextOverride?: string;
}

export interface CreateResult {
  plaintext: string;
  record: ApiKeyRecord;
}

export function apiKeysService(db: SupabaseClient) {
  const repo = apiKeysRepo(db);

  return {
    async create(input: CreateInput): Promise<CreateResult> {
      const plaintext = input.plaintextOverride ?? generatePlaintextKey();
      const record = await repo.insert({
        id: randomUUID(),
        name: input.name,
        tier: input.tier,
        keyHash: hashApiKey(plaintext),
        keyEncrypted: input.storeEncrypted || input.tier === 'master' ? encryptApiKey(plaintext) : null,
        dailyLimit: input.dailyLimit ?? null,
      });
      return { plaintext, record };
    },

    async revealById(id: string): Promise<string> {
      const record = await repo.findById(id);
      if (!record) throw NotFound('API key not found');
      if (!record.keyEncrypted) throw NotFound('Key was not stored for reveal');
      return decryptApiKey(record.keyEncrypted);
    },

    async list(opts: { includeRevoked?: boolean } = {}) {
      const records = await repo.list(opts);
      return records.map((r) => repo.publicView(r));
    },

    async revoke(id: string): Promise<void> {
      const record = await repo.findById(id);
      if (!record) throw NotFound('API key not found');
      await repo.revoke(id);
    },

    repo,
  };
}
