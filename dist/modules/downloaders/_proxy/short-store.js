/**
 * In-memory short URL store.
 *
 * Maps a short ID (8-char base64url) → signed proxy token string.
 * Entries auto-expire based on the token's embedded TTL so memory
 * doesn't grow unbounded on a long-running process.
 */
import { randomBytes } from 'node:crypto';
const store = new Map();
// Periodic cleanup every 5 minutes
let cleanupTimer = null;
function ensureCleanup() {
    if (cleanupTimer)
        return;
    cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [id, entry] of store) {
            if (entry.expiresAt <= now)
                store.delete(id);
        }
    }, 5 * 60 * 1000);
    // Don't block process shutdown
    if (cleanupTimer.unref)
        cleanupTimer.unref();
}
/**
 * Generate a short ID (8 chars, URL-safe).
 */
function generateId() {
    return randomBytes(6).toString('base64url'); // 6 bytes = 8 base64url chars
}
/**
 * Store a proxy token and return its short ID.
 * @param token - The full signed proxy token (payload.sig)
 * @param ttlMs - Time to live in milliseconds
 */
export function put(token, ttlMs) {
    ensureCleanup();
    // Avoid (extremely unlikely) collisions
    let id = generateId();
    let attempts = 0;
    while (store.has(id) && attempts < 5) {
        id = generateId();
        attempts++;
    }
    store.set(id, { token, expiresAt: Date.now() + ttlMs });
    return id;
}
/**
 * Retrieve and consume (or peek) a token by short ID.
 * Returns null if not found or expired.
 */
export function get(id) {
    const entry = store.get(id);
    if (!entry)
        return null;
    if (entry.expiresAt <= Date.now()) {
        store.delete(id);
        return null;
    }
    return entry.token;
}
/** Current store size (for observability). */
export function size() {
    return store.size;
}
//# sourceMappingURL=short-store.js.map