import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal } from '../../shared/errors.js';

/**
 * Daily-usage counter. Backed by the `rexapi.increment_usage` RPC defined
 * in supabase/schema.sql, which atomically increments the counter for
 * (bucket_date, counter_key) and refuses to push past the limit.
 *
 * Contract from the RPC:
 *   - p_limit < 0  → unlimited (always allowed, just increments).
 *   - p_limit >= 0 → only increments while count < p_limit. Otherwise
 *     `allowed=false` and `used` reflects the current value (not bumped).
 */

const RPC_INCREMENT = 'increment_usage';

export interface UsageResult {
  allowed: boolean;
  used: number;
  /** Echoed back from the RPC. -1 means unlimited. */
  limit: number;
}

interface RpcRow {
  allowed: boolean;
  used: number;
  limit_value: number;
}

/** YYYY-MM-DD in UTC. The reset boundary lives here so it's easy to reason about. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function quotaRepo(db: SupabaseClient) {
  return {
    /**
     * Atomic check-and-increment. Pass `limit < 0` to disable the gate
     * (e.g. for a tier with unlimited daily usage).
     */
    async increment(counterKey: string, limit: number, date: string = todayUtc()): Promise<UsageResult> {
      const { data, error } = await db.rpc(RPC_INCREMENT, {
        p_date: date,
        p_counter: counterKey,
        p_limit: Math.floor(limit),
      });
      if (error) throw Internal(`quota.increment: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null | undefined;
      if (!row) throw Internal('quota.increment: empty result');
      return {
        allowed: !!row.allowed,
        used: Number(row.used),
        limit: Number(row.limit_value),
      };
    },
  };
}
