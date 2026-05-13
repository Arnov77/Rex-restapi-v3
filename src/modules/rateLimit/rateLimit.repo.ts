import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '../../shared/errors.js';

const RPC_HIT = 'rate_limit_hit';
const RPC_GC = 'rate_limit_gc';

export interface HitResult {
  allowed: boolean;
  count: number;
  resetAt: Date;
}

export function rateLimitRepo(db: SupabaseClient) {
  return {
    async hit(key: string, windowSec: number, max: number): Promise<HitResult> {
      const { data, error } = await db.rpc(RPC_HIT, {
        p_key: String(key),
        p_window_s: Math.max(1, Math.floor(windowSec)),
        p_max: Math.max(0, Math.floor(max)),
      });
      if (error) throw Internal(`rateLimit.hit: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw Internal('rateLimit.hit: empty result');
      return {
        allowed: !!row.allowed,
        count: Number(row.count_out ?? row.count),
        resetAt: new Date(row.reset_at),
      };
    },

    async gc(olderThan: string = '1 day'): Promise<number> {
      const { data, error } = await db.rpc(RPC_GC, { p_older_than: olderThan });
      if (error) throw Internal(`rateLimit.gc: ${error.message}`);
      return Number(data ?? 0);
    },
  };
}
