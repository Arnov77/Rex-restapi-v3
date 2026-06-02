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
/** YYYY-MM-DD in UTC. The reset boundary lives here so it's easy to reason about. */
export function todayUtc(now = new Date()) {
    return now.toISOString().slice(0, 10);
}
export function quotaRepo(db) {
    return {
        /**
         * Atomic check-and-increment. Pass `limit < 0` to disable the gate
         * (e.g. for a tier with unlimited daily usage).
         */
        async increment(counterKey, limit, date = todayUtc()) {
            const { data, error } = await db.rpc(RPC_INCREMENT, {
                p_date: date,
                p_counter: counterKey,
                p_limit: Math.floor(limit),
            });
            if (error)
                throw Internal(`quota.increment: ${error.message}`);
            const row = (Array.isArray(data) ? data[0] : data);
            if (!row)
                throw Internal('quota.increment: empty result');
            return {
                allowed: !!row.allowed,
                used: Number(row.used),
                limit: Number(row.limit_value),
            };
        },
        /**
         * Read-only counter peek. Returns 0 when no row exists for the day yet
         * (a fresh counter just hasn't been created — semantically equivalent
         * to "used: 0").
         */
        async peek(counterKey, date = todayUtc()) {
            const { data, error } = await db
                .from('usage_daily')
                .select('count')
                .eq('bucket_date', date)
                .eq('counter_key', counterKey)
                .maybeSingle();
            if (error)
                throw Internal(`quota.peek: ${error.message}`);
            return data?.count ?? 0;
        },
        /**
         * Move a counter's value to a new key. Used when an API key is
         * regenerated — the user shouldn't get a free reset just by rotating.
         * Backed by the `transfer_usage` RPC defined in schema.sql.
         */
        async transfer(fromKey, toKey, date = todayUtc()) {
            const { data, error } = await db.rpc('transfer_usage', {
                p_date: date,
                p_from: fromKey,
                p_to: toKey,
            });
            if (error)
                throw Internal(`quota.transfer: ${error.message}`);
            return Number(data ?? 0);
        },
    };
}
//# sourceMappingURL=quota.repo.js.map