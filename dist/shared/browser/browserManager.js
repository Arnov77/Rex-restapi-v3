import { chromium } from 'playwright-core';
import { loadEnv } from '../../config/env.js';
import { Internal } from '../errors.js';
import { PagePool } from './pagePool.js';
/**
 * Shared singleton Chromium + page pool for all media/tools modules
 * (screenshot, brat, quote, …).
 *
 * Architecture:
 *   - One Chromium process (singleton, auto-reconnect on crash).
 *   - N pooled BrowserContexts (PAGE_POOL_SIZE) reused across requests.
 *     Each context is an incognito profile — cookies/storage are cleared
 *     between uses, not shared across concurrent requests.
 *   - `withPage(fn, opts)` acquires a context from the pool, opens a
 *     fresh page inside it, runs `fn`, closes the page, and releases
 *     the context. The pool handles backpressure: if all slots are busy
 *     the caller queues with a timeout (PAGE_POOL_ACQUIRE_TIMEOUT_MS).
 *   - AbortSignal support: pass `opts.signal` (from `req.raw` in Fastify
 *     v5) and the render is abandoned early if the client disconnects
 *     while queued OR mid-render. Saves CPU on abandoned requests.
 *
 * Why pool instead of newContext-per-request:
 *   - newContext() costs ~80–150 ms on Linux (IPC to the browser process
 *     to create an incognito profile + allocate renderer). At 30 req/s
 *     that's 3–4.5 seconds of pure overhead per second of wall-clock.
 *   - Pooled contexts are already warm — the only per-request cost is
 *     newPage() (~5 ms) + clearCookies() on release (~2 ms).
 *   - Bounded pool = bounded concurrency = predictable RAM. Without a
 *     pool, N concurrent requests open N contexts, each consuming
 *     ~50–100 MB. With a pool of 4, peak RSS is capped regardless of
 *     request concurrency.
 */
// ── Browser singleton ──────────────────────────────────────────────────
const DEFAULT_VIEWPORT = { width: 900, height: 600 };
let instance = null;
let launching = null;
let pool = null;
function buildLaunchOptions() {
    const env = loadEnv();
    const opts = {
        headless: true,
        args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'],
    };
    if (env.CHROME_BIN)
        opts.executablePath = env.CHROME_BIN;
    return opts;
}
async function launch() {
    try {
        const browser = await chromium.launch(buildLaunchOptions());
        // Auto-recover from upstream crashes — drop the stale handle so the
        // next caller relaunches transparently instead of getting a dead browser.
        browser.on('disconnected', () => {
            if (instance === browser) {
                instance = null;
                // Drain the pool — all contexts are dead after a disconnect.
                pool?.drain().catch(() => { });
                pool = null;
            }
        });
        return browser;
    }
    catch (err) {
        throw Internal('Failed to launch Chromium', { message: err.message });
    }
}
export async function getBrowser() {
    if (instance)
        return instance;
    if (!launching) {
        launching = launch()
            .then((b) => {
            instance = b;
            return b;
        })
            .finally(() => {
            launching = null;
        });
    }
    return launching;
}
function getPool() {
    if (pool)
        return pool;
    const env = loadEnv();
    pool = new PagePool({
        size: env.PAGE_POOL_SIZE,
        acquireTimeoutMs: env.PAGE_POOL_ACQUIRE_TIMEOUT_MS,
    });
    if (instance)
        pool.attach(instance);
    return pool;
}
/**
 * Run `fn` inside a pooled page. Handles acquire → newPage → fn →
 * page.close → release in one call. This is the primary entry point
 * for screenshot/brat/quote services.
 */
export async function withPage(fn, opts = {}) {
    const { signal, viewport } = opts;
    // Ensure browser is up and pool is attached.
    const browser = await getBrowser();
    const p = getPool();
    if (!p.stats.created && browser)
        p.attach(browser);
    // Acquire a slot (may queue with timeout + abort support).
    const slot = await p.acquire({ signal, viewport: viewport ?? undefined });
    // Set viewport if the caller needs something specific.
    const vp = viewport ?? DEFAULT_VIEWPORT;
    const page = await slot.context.newPage();
    // If the viewport doesn't match the slot's default, override it.
    // This is a lightweight IPC call (~1 ms) — acceptable per-request.
    await page.setViewportSize(vp);
    // Wire abort → early page close so in-flight Playwright calls reject.
    let abortListener = null;
    if (signal && !signal.aborted) {
        abortListener = () => {
            page.close().catch(() => { });
        };
        signal.addEventListener('abort', abortListener, { once: true });
    }
    try {
        return await fn(page, slot.context);
    }
    finally {
        // Clean up abort listener.
        if (signal && abortListener) {
            signal.removeEventListener('abort', abortListener);
        }
        // Close page (idempotent — if abort already closed it, this is a no-op).
        await page.close().catch(() => { });
        // Release context back to pool.
        await p.release(slot).catch(() => { });
    }
}
/**
 * Legacy `withContext` — kept for any call site that needs raw context
 * access without the pool (e.g., multi-page workflows in brat animation).
 * Uses the pool under the hood.
 */
export async function withContext(fn, contextOptions = {}) {
    return withPage(async (_page, ctx) => fn(ctx), contextOptions);
}
/**
 * Graceful shutdown. Drains the pool (closes all contexts), then closes
 * the browser process.
 */
export async function shutdown() {
    if (pool) {
        await pool.drain().catch(() => { });
        pool = null;
    }
    const current = instance;
    instance = null;
    if (!current)
        return;
    await current.close().catch(() => { });
}
/** Pool stats — useful for health endpoints or metrics. */
export function poolStats() {
    return pool?.stats ?? { size: 0, created: 0, busy: 0, idle: 0, queued: 0, acquireCount: 0, releaseCount: 0, timeoutCount: 0 };
}
/** Test-only: reset cached singleton. Not exported from a public barrel. */
export function __resetForTests() {
    instance = null;
    launching = null;
    pool = null;
}
export const browserManager = { getBrowser, withContext, withPage, shutdown, poolStats };
export default browserManager;
//# sourceMappingURL=browserManager.js.map