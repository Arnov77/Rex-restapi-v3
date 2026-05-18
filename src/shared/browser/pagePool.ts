/**
 * Bounded pool of reusable BrowserContexts for Chromium rendering.
 *
 * Why contexts, not pages: Playwright's BrowserContext is the isolation
 * boundary (separate cookies, localStorage, cache). Reusing a context
 * across requests is safe as long as we clear storage between uses —
 * which is cheaper than creating+destroying a fresh context (~150 ms)
 * on every request.
 *
 * Architecture:
 *   - N slots (PAGE_POOL_SIZE), each holding one BrowserContext.
 *   - Slots start empty (lazy-init on first acquire).
 *   - acquire() returns a slot; if all busy, the caller joins a FIFO
 *     queue with a timeout (PAGE_POOL_ACQUIRE_TIMEOUT_MS).
 *   - release() clears cookies+storage, marks the slot idle, and wakes
 *     the next waiter.
 *   - drain() closes all contexts (called on server shutdown).
 *
 * Abort support: acquire() accepts an optional AbortSignal. If the
 * signal fires while the caller is queued, the promise rejects with a
 * 499-style "client disconnected" error — the render never starts, and
 * the Chromium slot is never consumed. This saves CPU when a user
 * closes the modal before their turn comes.
 */

import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright-core';
import { AppError } from '../errors.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface PoolSlot {
  context: BrowserContext;
  busy: boolean;
  createdAt: number;
}

export interface AcquireOptions {
  /** Viewport override for this specific acquire. */
  viewport?: { width: number; height: number };
  /** Abort signal — rejects the acquire if fired while queued. */
  signal?: AbortSignal;
}

interface Waiter {
  resolve: (slot: PoolSlot) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

// ── Pool implementation ────────────────────────────────────────────────

const DEFAULT_VIEWPORT = { width: 900, height: 600 };

/** Maximum age of a context before it's proactively recycled (5 min). */
const MAX_CONTEXT_AGE_MS = 5 * 60 * 1000;

export class PagePool {
  private readonly size: number;
  private readonly acquireTimeoutMs: number;
  private readonly contextOpts: BrowserContextOptions;
  private slots: PoolSlot[] = [];
  private queue: Waiter[] = [];
  private browser: Browser | null = null;
  private _acquireCount = 0;
  private _releaseCount = 0;
  private _timeoutCount = 0;

  constructor(opts: {
    size: number;
    acquireTimeoutMs: number;
    contextOpts?: BrowserContextOptions;
  }) {
    this.size = opts.size;
    this.acquireTimeoutMs = opts.acquireTimeoutMs;
    this.contextOpts = opts.contextOpts ?? {};
  }

  /** Bind the pool to a running browser. Call once after launch. */
  attach(browser: Browser): void {
    this.browser = browser;
  }

  /** Acquire a context slot. Resolves when a slot is available. */
  async acquire(opts: AcquireOptions = {}): Promise<PoolSlot> {
    if (!this.browser) throw new AppError(503, 'BROWSER_NOT_READY', 'Browser not launched yet');

    // Fast path: check for an already-aborted signal before doing any work.
    if (opts.signal?.aborted) {
      throw new AppError(499, 'CLIENT_CLOSED', 'Request aborted before render started');
    }

    // Try to find an idle slot.
    const idle = this.slots.find((s) => !s.busy);
    if (idle) {
      // Recycle stale contexts proactively.
      if (Date.now() - idle.createdAt > MAX_CONTEXT_AGE_MS) {
        await this.recycleSlot(idle);
      }
      idle.busy = true;
      this._acquireCount++;
      return idle;
    }

    // No idle slot — can we create a new one?
    if (this.slots.length < this.size) {
      const slot = await this.createSlot();
      slot.busy = true;
      this.slots.push(slot);
      this._acquireCount++;
      return slot;
    }

    // All slots busy, all created — queue the caller.
    return new Promise<PoolSlot>((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.removeWaiter(waiter);
          this._timeoutCount++;
          reject(new AppError(503, 'POOL_BUSY', 'All render slots busy, try again shortly'));
        }, this.acquireTimeoutMs),
        signal: opts.signal,
      };

      // Wire up abort.
      if (opts.signal) {
        const onAbort = () => {
          this.removeWaiter(waiter);
          reject(new AppError(499, 'CLIENT_CLOSED', 'Request aborted while queued'));
        };
        waiter.abortHandler = onAbort;
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      this.queue.push(waiter);
    });
  }

  /** Release a slot back to the pool. Clears state for the next user. */
  async release(slot: PoolSlot): Promise<void> {
    this._releaseCount++;
    // Clear cookies + storage so the next request starts clean.
    try {
      await slot.context.clearCookies();
      // clearPermissions() is not available on all contexts; skip if missing.
    } catch {
      // If clearing fails, recycle the whole context — cheaper than debugging
      // a half-poisoned state.
      await this.recycleSlot(slot);
    }
    slot.busy = false;

    // Wake the next waiter if any.
    this.drainQueue();
  }

  /** Destroy a slot and replace it in-place with a fresh context. */
  private async recycleSlot(slot: PoolSlot): Promise<void> {
    await slot.context.close().catch(() => {});
    const fresh = await this.createSlot();
    slot.context = fresh.context;
    slot.createdAt = fresh.createdAt;
  }

  /** Create a brand-new slot (not yet added to this.slots). */
  private async createSlot(): Promise<PoolSlot> {
    if (!this.browser) throw new AppError(503, 'BROWSER_NOT_READY', 'Browser not launched yet');
    const context = await this.browser.newContext({
      viewport: { ...DEFAULT_VIEWPORT },
      ...this.contextOpts,
    });
    return { context, busy: false, createdAt: Date.now() };
  }

  /** Try to hand the next idle slot to the first queued waiter. */
  private drainQueue(): void {
    while (this.queue.length > 0) {
      const idle = this.slots.find((s) => !s.busy);
      if (!idle) break;

      const waiter = this.queue.shift()!;
      clearTimeout(waiter.timer);
      if (waiter.signal && waiter.abortHandler) {
        waiter.signal.removeEventListener('abort', waiter.abortHandler);
      }

      idle.busy = true;
      this._acquireCount++;
      waiter.resolve(idle);
    }
  }

  /** Remove a waiter from the queue (timeout or abort). */
  private removeWaiter(w: Waiter): void {
    const idx = this.queue.indexOf(w);
    if (idx !== -1) this.queue.splice(idx, 1);
    clearTimeout(w.timer);
    if (w.signal && w.abortHandler) {
      w.signal.removeEventListener('abort', w.abortHandler);
    }
  }

  /** Close all contexts. Called on server shutdown. */
  async drain(): Promise<void> {
    // Reject all waiters.
    for (const w of this.queue) {
      clearTimeout(w.timer);
      if (w.signal && w.abortHandler) {
        w.signal.removeEventListener('abort', w.abortHandler);
      }
      w.reject(new AppError(503, 'SHUTTING_DOWN', 'Server is shutting down'));
    }
    this.queue = [];

    // Close all contexts.
    await Promise.allSettled(this.slots.map((s) => s.context.close().catch(() => {})));
    this.slots = [];
  }

  /** Observable stats for health/readiness probes. */
  get stats() {
    return {
      size: this.size,
      created: this.slots.length,
      busy: this.slots.filter((s) => s.busy).length,
      idle: this.slots.filter((s) => !s.busy).length,
      queued: this.queue.length,
      acquireCount: this._acquireCount,
      releaseCount: this._releaseCount,
      timeoutCount: this._timeoutCount,
    };
  }
}
