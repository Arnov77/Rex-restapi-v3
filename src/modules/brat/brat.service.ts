// gifenc has no `exports` map and ships CJS as `main`; named ESM imports
// from the bare specifier fail under Node 20. Point at the ESM build directly.
import { createHash } from 'node:crypto';
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js';
import { PNG } from 'pngjs';
import { withPage } from '../../shared/browser/browserManager.js';
import { assertPublicUrl } from '../../shared/utils/ssrfGuard.js';
import { Internal } from '../../shared/errors.js';
import { LruCache } from '../../shared/utils/lruCache.js';
import { renderBratHtml } from './brat.template.js';
import type { BratQuery } from './brat.schemas.js';

export interface BratResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif';
  format: 'png' | 'jpeg' | 'gif';
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
} as const;

/**
 * Decode a PNG buffer to raw RGBA in node. Uses pngjs (pure JS) so we don't
 * round-trip pixel data through page.evaluate — that JSON-serialized a
 * 720*720*4 = ~2M-element number array per frame and dominated wall-time.
 */
function pngToRgba(png: Buffer): Uint8ClampedArray {
  const decoded = PNG.sync.read(png);
  return new Uint8ClampedArray(
    decoded.data.buffer,
    decoded.data.byteOffset,
    decoded.data.byteLength,
  );
}

/**
 * In-memory cache of finished brat renders. Brat is fully deterministic
 * given its query — same params always produce identical bytes — so we can
 * skip the browser entirely on a hit. Bounded LRU with TTL keeps memory
 * predictable; in-flight Map dedupes concurrent identical requests so a
 * burst from N clients only spawns ONE render.
 */
const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const cache = new LruCache<string, BratResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<BratResult>>();

function cacheKey(opts: BratQuery): string {
  // JSON.stringify with sorted keys → stable hash regardless of query order.
  const sorted = Object.fromEntries(
    Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

export async function generate(opts: BratQuery): Promise<BratResult> {
  // SSRF guard runs BEFORE the browser is touched. Same rule as screenshot:
  // a blocked URL must never reach Playwright.
  if (opts.bgImage) await assertPublicUrl(opts.bgImage);

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (opts.format === 'gif' ? generateGif(opts) : generateStill(opts))
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, promise);
  return promise;
}

async function generateStill(opts: BratQuery): Promise<BratResult> {
  const html = renderBratHtml(opts);
  const buffer = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, {
          timeout: 2_000,
        })
        .catch(() => {});
      const fmt = opts.format as 'png' | 'jpeg';
      const shotOpts: Parameters<typeof page.screenshot>[0] = { type: fmt };
      if (fmt === 'jpeg') shotOpts.quality = opts.quality;
      return page.screenshot(shotOpts);
    },
    { viewport: { width: opts.width, height: opts.height } },
  );

  if (!buffer || buffer.length === 0) throw Internal('Brat produced an empty buffer');
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

async function generateGif(opts: BratQuery): Promise<BratResult> {
  // "Bratvid" — progressive word reveal. Frame N shows the first N words of
  // the caption. We render the FULL text first so the shrink-to-fit loop
  // settles on the final font-size, then per frame replace innerText with a
  // cumulative slice. The last frame holds longer so the full caption is
  // readable before the loop wraps.
  const words = opts.text.split(/\s+/).filter(Boolean);
  const frameCount = Math.max(1, Math.min(words.length, 30));
  const HOLD_MS = 1200;

  const buffer = await withPage(
    async (page) => {
      const html = renderBratHtml(opts);
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, {
          timeout: 2_000,
        })
        .catch(() => {});

      const enc = GIFEncoder();
      const setText = (s: string) =>
        page.evaluate((v: string) => {
          const el = (globalThis as any).document.getElementById('t');
          if (el) el.textContent = v;
        }, s);

      // Quantize once on the richest (last) frame, then reuse the palette
      // for every frame. Brat is just bg + text in one color with blur
      // halos — the palette barely changes across frames, and reusing it
      // skips the most expensive per-frame step (~40-60% of wall-time).
      let sharedPalette: number[][] | null = null;

      for (let i = 0; i < frameCount; i++) {
        const partial = words.slice(0, i + 1).join(' ');
        await setText(partial);
        const png = await page.screenshot({ type: 'png', omitBackground: false });
        if (!png || png.length === 0) throw Internal('Brat frame produced empty buffer');
        const rgba = pngToRgba(png);
        if (!sharedPalette) sharedPalette = quantize(rgba, 64, { format: 'rgb444' });
        const indexed = applyPalette(rgba, sharedPalette, 'rgb444');
        const isLast = i === frameCount - 1;
        enc.writeFrame(indexed, opts.width, opts.height, {
          palette: i === 0 ? sharedPalette : undefined,
          delay: isLast ? HOLD_MS : opts.delay,
        });
      }
      enc.finish();
      return Buffer.from(enc.bytes());
    },
    { viewport: { width: opts.width, height: opts.height } },
  );

  if (!buffer || buffer.length === 0) throw Internal('Brat GIF produced an empty buffer');
  return { buffer, mimeType: MIME.gif, format: 'gif' };
}

export const bratService = { generate, cache };

