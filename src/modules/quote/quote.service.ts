import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withPage } from '../../shared/browser/browserManager.js';
import { assertPublicUrl } from '../../shared/utils/ssrfGuard.js';
import { Internal } from '../../shared/errors.js';
import { LruCache } from '../../shared/utils/lruCache.js';
import { renderQuoteHtml } from './quote.template.js';
import type { QuoteQuery } from './quote.schemas.js';

export interface QuoteResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

/**
 * In-memory cache for quote renders. Quote output is fully deterministic
 * given its query, identical to brat's caching strategy: bounded LRU + TTL
 * + in-flight dedup so a burst of identical requests spawns ONE render.
 */
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache<string, QuoteResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<QuoteResult>>();

function cacheKey(opts: QuoteQuery): string {
  const sorted = Object.fromEntries(
    Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

export async function generate(opts: QuoteQuery): Promise<QuoteResult> {
  // SSRF guard BEFORE touching Chromium — same rule as brat/screenshot.
  if (opts.avatar) await assertPublicUrl(opts.avatar);

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderOnce(opts)
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function renderOnce(opts: QuoteQuery): Promise<QuoteResult> {
  const html = renderQuoteHtml(opts);
  // Width is auto on the card itself; we just need a wide-enough viewport.
  // Height grows with text, so 2000px max keeps everything in-frame.
  const png = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 2_000 })
        .catch(() => {});
      // Element-bounded screenshot → output matches the card exactly.
      const el = await page.$('#card');
      if (!el) throw Internal('Quote card element not found');
      return el.screenshot({ type: 'png', omitBackground: true });
    },
    { viewport: { width: opts.width, height: 2000 } },
  );

  if (!png || png.length === 0) throw Internal('Quote produced empty buffer');

  let buffer: Buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
  if (opts.format === 'jpeg') {
    // JPEG has no alpha — flatten onto white to avoid black background.
    buffer = await sharp(buffer)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: opts.quality })
      .toBuffer();
  } else if (opts.format === 'webp') {
    buffer = await sharp(buffer).webp({ quality: opts.quality, effort: 3 }).toBuffer();
  }

  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

export const quoteService = { generate, cache };
