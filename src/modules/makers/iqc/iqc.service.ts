import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { withPage } from '@shared/browser/browserManager.js';
import { Internal } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { IqcQuery } from './iqc.schemas.js';
import { renderIqcHtml } from './iqc.template.js';

export interface IqcResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

export interface IqcGenerateOptions {
  signal?: AbortSignal;
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache<string, IqcResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<IqcResult>>();

function cacheKey(opts: IqcQuery): string {
  const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

export async function generate(opts: IqcQuery, { signal }: IqcGenerateOptions = {}): Promise<IqcResult> {
  if (opts.media) await assertPublicUrl(opts.media);

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderOnce(opts, signal)
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

async function renderOnce(opts: IqcQuery, signal?: AbortSignal): Promise<IqcResult> {
  const html = renderIqcHtml(opts);

  const png = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 5_000 })
        .catch(() => {});

      const el = await page.$('#canvas');
      if (!el) throw Internal('IQC canvas element not found');

      return el.screenshot({ type: 'png' });
    },
    { viewport: { width: 736, height: 1308 }, signal },
  );

  if (!png || png.length === 0) throw Internal('IQC produced empty buffer');

  let buffer: Buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);

  if (opts.format === 'jpeg') {
    buffer = await sharp(buffer).jpeg({ quality: opts.quality }).toBuffer();
  } else if (opts.format === 'webp') {
    buffer = await sharp(buffer).webp({ quality: opts.quality, effort: 3 }).toBuffer();
  }

  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

export const iqcService = { generate, cache };