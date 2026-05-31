/**
 * Self-service business logic for `/api/me/*`. Sits in front of the
 * existing users + apiKeys + quota repos so the routes layer stays thin
 * and the auth-rules (password re-confirm, "you can only see your own
 * key") live in one place.
 */

import bcrypt from 'bcryptjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { usersRepo } from '../auth/users.repo.js';
import { apiKeysService } from '../apiKeys/apiKeys.service.js';
import type { ApiKeyRecord } from '../apiKeys/apiKeys.repo.js';
import { quotaRepo, todayUtc } from '../quota/quota.repo.js';
import { loadEnv } from '../../config/env.js';
import { Forbidden, NotFound, Unauthorized } from '@shared/errors.js';

export interface UsageView {
  date: string;
  used: number;
  /** null when caller is on a tier with unlimited quota (master). */
  limit: number | null;
  remaining: number | null;
  resetInSeconds: number;
}

function secondsUntilUtcMidnight(now: Date = new Date()): number {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
}

export function meService(db: SupabaseClient) {
  const users = usersRepo(db);
  const keys = apiKeysService(db);
  const quota = quotaRepo(db);

  /**
   * Resolve the user's API key record. Throws NotFound when the user has
   * no key linked (shouldn't happen for accounts created via /auth/register
   * — that flow always provisions one — but defensive against legacy rows).
   */
  async function resolveKey(userId: string): Promise<ApiKeyRecord> {
    const user = await users.findById(userId);
    if (!user) throw Unauthorized('User no longer exists');
    if (!user.apiKeyId) throw NotFound('No API key linked to this user');
    const key = await keys.repo.findById(user.apiKeyId);
    if (!key) throw NotFound('API key no longer exists');
    return key;
  }

  /**
   * Re-verify the user's password. Used as a second factor in front of
   * destructive or secret-revealing operations (regenerate, reveal). A
   * stolen JWT alone shouldn't be enough to leak/rotate the bot key.
   */
  async function confirmPassword(userId: string, password: string): Promise<void> {
    const user = await users.findById(userId);
    if (!user) throw Unauthorized('User no longer exists');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw Forbidden('Password confirmation failed');
  }

  return {
    async getMe(userId: string) {
      const user = await users.findById(userId);
      if (!user) throw Unauthorized('User no longer exists');
      return users.publicView(user);
    },

    async getKey(userId: string) {
      const key = await resolveKey(userId);
      return keys.repo.publicView(key);
    },

    async revealKey(userId: string, password: string): Promise<string> {
      await confirmPassword(userId, password);
      const key = await resolveKey(userId);
      if (!key.keyEncrypted) {
        // Self-provisioned user keys aren't stored encrypted by default
        // (we never need to show them again — user got the plaintext at
        // register-time). Force the user to regenerate to recover.
        throw NotFound('Key was not stored for reveal — regenerate to get a new plaintext');
      }
      return keys.revealById(key.id);
    },

    async regenerateKey(userId: string, password: string) {
      await confirmPassword(userId, password);
      const key = await resolveKey(userId);
      if (key.revoked) throw Forbidden('Cannot regenerate a revoked key');
      return keys.regenerate(key.id);
    },

    async getUsage(userId: string): Promise<UsageView> {
      const env = loadEnv();
      const key = await resolveKey(userId);
      const date = todayUtc();
      const reset = secondsUntilUtcMidnight();

      // Master tier: unlimited. Surface used count for transparency but
      // mark limit/remaining as null.
      if (key.tier === 'master') {
        const used = await quota.peek(`key:${key.id}`, date);
        return { date, used, limit: null, remaining: null, resetInSeconds: reset };
      }

      // dailyLimit === null → admin granted unlimited. Same display as master.
      if (key.dailyLimit === null) {
        const used = await quota.peek(`key:${key.id}`, date);
        return { date, used, limit: null, remaining: null, resetInSeconds: reset };
      }

      const limit = key.dailyLimit;
      const used = await quota.peek(`key:${key.id}`, date);
      return {
        date,
        used,
        limit,
        remaining: Math.max(0, limit - used),
        resetInSeconds: reset,
      };
    },
  };
}
