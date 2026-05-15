// gifenc has no `exports` map and ships CJS as `main`; named ESM imports
// from the bare specifier fail under Node 20. Point at the ESM build directly.
import { createHash } from 'node:crypto';
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { withPage } from '../../shared/browser/browserManager.js';
import { assertPublicUrl } from '../../shared/utils/ssrfGuard.js';
import { Internal } from '../../shared/errors.js';
import { LruCache } from '../../shared/utils/lruCache.js';
import { renderBratHtml } from './brat.template.js';
import type { BratQuery } from './brat.schemas.js';

export interface BratResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  format: 'png' | 'jpeg' | 'gif' | 'webp';
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
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

  const animated = opts.format === 'gif' || opts.format === 'webp';
  const isMulti = animated && /\s/.test(opts.text.trim());
  const promise = (isMulti ? generateAnimated(opts) : generateStill(opts))
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
      // Playwright's page.screenshot only does png/jpeg. For still webp we
      // grab a PNG and re-encode via sharp — fast since libwebp is native.
      const shotType: 'png' | 'jpeg' = opts.format === 'jpeg' ? 'jpeg' : 'png';
      const shotOpts: Parameters<typeof page.screenshot>[0] = { type: shotType };
      if (shotType === 'jpeg') shotOpts.quality = opts.quality;
      const png = await page.screenshot(shotOpts);
      if (opts.format === 'webp') {
        return sharp(png).webp({ quality: opts.quality, effort: 3 }).toBuffer();
      }
      return png;
    },
    { viewport: { width: opts.width, height: opts.height } },
  );

  if (!buffer || buffer.length === 0) throw Internal('Brat produced an empty buffer');
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

/**
 * Capture progressive-word-reveal frames. Frame N shows the first N words.
 * Returns raw RGBA buffers — the caller picks GIF or WebP encoding.
 */
async function captureFrames(opts: BratQuery): Promise<{ rgba: Uint8ClampedArray[] }> {
  const words = opts.text.split(/\s+/).filter(Boolean);
  const frameCount = Math.max(1, Math.min(words.length, 30));

  return withPage(
    async (page) => {
      const html = renderBratHtml(opts);
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, {
          timeout: 2_000,
        })
        .catch(() => {});

      const rgba: Uint8ClampedArray[] = [];
      for (let i = 0; i < frameCount; i++) {
        const partial = words.slice(0, i + 1).join(' ');
        await page.evaluate((v: string) => {
          const el = (globalThis as any).document.getElementById('t');
          if (el) el.textContent = v;
        }, partial);
        const png = await page.screenshot({ type: 'png', omitBackground: false });
        if (!png || png.length === 0) throw Internal('Brat frame produced empty buffer');
        rgba.push(pngToRgba(png));
      }
      return { rgba };
    },
    { viewport: { width: opts.width, height: opts.height } },
  );
}

async function generateAnimated(opts: BratQuery): Promise<BratResult> {
  const { rgba } = await captureFrames(opts);
  const HOLD_MS = 1200;
  const buffer = opts.format === 'webp'
    ? await encodeWebp(opts, rgba, HOLD_MS)
    : encodeGif(opts, rgba, HOLD_MS);
  if (!buffer || buffer.length === 0) throw Internal('Brat animation produced empty buffer');
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

function encodeGif(opts: BratQuery, frames: Uint8ClampedArray[], holdMs: number): Buffer {
  const enc = GIFEncoder();
  // Quantize once on the first frame, reuse palette across all frames —
  // cuts ~40-60% off encoding time for brat's near-static palette.
  let sharedPalette: number[][] | null = null;
  for (let i = 0; i < frames.length; i++) {
    const rgba = frames[i]!;
    if (!sharedPalette) sharedPalette = quantize(rgba, 64, { format: 'rgb444' });
    const indexed = applyPalette(rgba, sharedPalette, 'rgb444');
    const isLast = i === frames.length - 1;
    enc.writeFrame(indexed, opts.width, opts.height, {
      palette: i === 0 ? sharedPalette : undefined,
      delay: isLast ? holdMs : opts.delay,
    });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

async function encodeWebp(
  opts: BratQuery,
  frames: Uint8ClampedArray[],
  holdMs: number,
): Promise<Buffer> {
  // Sharp builds animated WebP from a single tall raw image where every
  // page is `pageHeight` rows. Per-frame delay is set via the `delay` array
  // metadata; loop=0 means infinite.
  const frameBytes = opts.width * opts.height * 4;
  const stacked = Buffer.alloc(frameBytes * frames.length);
  for (let i = 0; i < frames.length; i++) {
    Buffer.from(frames[i]!.buffer, frames[i]!.byteOffset, frames[i]!.byteLength).copy(
      stacked,
      i * frameBytes,
    );
  }
  const delay = frames.map((_, i) => (i === frames.length - 1 ? holdMs : opts.delay));
  return sharp(stacked, {
    raw: { width: opts.width, height: opts.height * frames.length, channels: 4 },
    pageHeight: opts.height,
  })
    .webp({ quality: opts.quality, effort: 3, loop: 0, delay })
    .toBuffer();
}

export const bratService = { generate, cache };

