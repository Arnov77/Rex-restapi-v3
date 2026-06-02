import { LruCache } from '../../shared/utils/lruCache.js';
/**
 * Per-instance cache for the API-key authentication hot path.
 *
 * Two independent concerns:
 *  1. Record cache — memoises *positive* findByHash / findById lookups for a
 *     short TTL so repeat requests from the same key skip the DB round-trip.
 *     Negative (not-found) results are intentionally NOT cached, so a freshly
 *     minted key authenticates immediately.
 *  2. Touch throttle — collapses `last_used_at` UPDATEs to at most once per
 *     key per window, removing the per-request write amplification on the
 *     `api_keys` table.
 *
 * In-process only. Revocations/updates are reflected immediately on the
 * issuing instance via {@link invalidateById}; other instances converge within
 * `ttlMs`. Keep `ttlMs` short (default 30s) so that staleness window is small.
 * Swap for a shared store (Redis) if cross-instance invalidation is needed.
 */
export class ApiKeyCache {
    byHash;
    byId;
    touchSeen;
    recordsEnabled;
    throttleEnabled;
    constructor(opts) {
        const max = Math.max(1, opts.max);
        this.recordsEnabled = opts.ttlMs > 0;
        this.throttleEnabled = opts.touchThrottleMs > 0;
        this.byHash = new LruCache({ max, ttlMs: Math.max(1, opts.ttlMs) });
        this.byId = new LruCache({ max, ttlMs: Math.max(1, opts.ttlMs) });
        this.touchSeen = new LruCache({ max, ttlMs: Math.max(1, opts.touchThrottleMs) });
    }
    /** Cached record for a key hash, or undefined on miss/expiry/disabled. */
    getByHash(hash) {
        return this.recordsEnabled ? this.byHash.get(hash) : undefined;
    }
    /** Cached record for a key id, or undefined on miss/expiry/disabled. */
    getById(id) {
        return this.recordsEnabled ? this.byId.get(id) : undefined;
    }
    /** Memoise a freshly fetched record under both the hash and id indexes. */
    store(record) {
        if (!this.recordsEnabled)
            return;
        this.byHash.set(record.keyHash, record);
        this.byId.set(record.id, record);
    }
    /**
     * Drop a record from both indexes. Call after revoke/update/regenerate/
     * activate so the change takes effect immediately on this instance instead
     * of waiting out the TTL.
     */
    invalidateById(id) {
        const rec = this.byId.get(id);
        if (rec)
            this.byHash.delete(rec.keyHash);
        this.byId.delete(id);
    }
    /**
     * Returns true at most once per `touchThrottleMs` per key. The caller should
     * only issue the `last_used_at` write when this returns true.
     */
    shouldTouch(id) {
        if (!this.throttleEnabled)
            return true;
        if (this.touchSeen.get(id))
            return false;
        this.touchSeen.set(id, true);
        return true;
    }
}
//# sourceMappingURL=apiKeys.cache.js.map