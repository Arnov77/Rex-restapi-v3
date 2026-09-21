import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '@shared/errors.js';

const TABLE = 'password_reset_tokens';

export function resetTokensRepo(db: SupabaseClient) {
  return {
    async create(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
      const { error } = await db.from(TABLE).insert({
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt.toISOString(),
      });
      if (error) throw Internal(`resetTokens.create: ${error.message}`);
    },

    /** How many resets this account asked for recently — caps inbox spam. */
    async countRecent(userId: string, since: Date): Promise<number> {
      const { count, error } = await db
        .from(TABLE)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', since.toISOString());
      if (error) throw Internal(`resetTokens.countRecent: ${error.message}`);
      return count ?? 0;
    },

    /** Unused and unexpired only. */
    async findValid(tokenHash: string): Promise<{ id: string; user_id: string } | null> {
      const { data, error } = await db
        .from(TABLE)
        .select('id, user_id')
        .eq('token_hash', tokenHash)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle<{ id: string; user_id: string }>();
      if (error) throw Internal(`resetTokens.findValid: ${error.message}`);
      return data;
    },

    /** Burn every outstanding token for the user, not just the one used. */
    async consumeAllForUser(userId: string): Promise<void> {
      const { error } = await db
        .from(TABLE)
        .update({ used_at: new Date().toISOString() })
        .eq('user_id', userId)
        .is('used_at', null);
      if (error) throw Internal(`resetTokens.consumeAllForUser: ${error.message}`);
    },
  };
}
