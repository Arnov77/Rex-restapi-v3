export class LruCache {
    map = new Map();
    max;
    ttlMs;
    hits = 0;
    misses = 0;
    constructor(opts) {
        this.max = opts.max;
        this.ttlMs = opts.ttlMs;
    }
    get(key) {
        const entry = this.map.get(key);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        if (entry.expiresAt < Date.now()) {
            this.map.delete(key);
            this.misses++;
            return undefined;
        }
        // Re-insert for LRU recency.
        this.map.delete(key);
        this.map.set(key, entry);
        this.hits++;
        return entry.value;
    }
    set(key, value) {
        if (this.map.has(key))
            this.map.delete(key);
        this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
        while (this.map.size > this.max) {
            const oldest = this.map.keys().next().value;
            if (oldest === undefined)
                break;
            this.map.delete(oldest);
        }
    }
    /** Remove a single entry. No-op when the key is absent. */
    delete(key) {
        this.map.delete(key);
    }
    get size() {
        return this.map.size;
    }
    clear() {
        this.map.clear();
        this.hits = 0;
        this.misses = 0;
    }
}
//# sourceMappingURL=lruCache.js.map