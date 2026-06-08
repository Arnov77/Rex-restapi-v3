/**
 * Tiny LRU + TTL cache. Map preserves insertion order, so the oldest key
 * is always `keys().next()`. Good enough for a single-process render cache;
 * swap for Redis if we ever need to share across instances.
 *
 * Cache otomatis dinonaktifkan di NODE_ENV=development.
 */
export interface LruOptions {
  max: number;
  ttlMs: number;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

export class LruCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly max: number;
  private readonly ttlMs: number;
  private readonly isDev: boolean;
  hits = 0;
  misses = 0;

  constructor(opts: LruOptions) {
    this.max = opts.max;
    this.ttlMs = opts.ttlMs;
    this.isDev = process.env['NODE_ENV'] === 'development';
  }

  get(key: K): V | undefined {
    if (this.isDev) return undefined; // bypass cache di dev mode
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

  set(key: K, value: V): void {
    if (this.isDev) return; // bypass cache di dev mode
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  /** Remove a single entry. No-op when the key is absent. */
  delete(key: K): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
