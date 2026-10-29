import axios from 'axios';
import { createHash } from 'node:crypto';
import { loadEnv } from '../../../config/env.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { IqcQuery } from './iqc.schemas.js';

export interface IqcResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache<string, IqcResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<IqcResult>>();

function cacheKey(opts: IqcQuery): string {
  const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

async function renderRemote(opts: IqcQuery, signal?: AbortSignal): Promise<IqcResult> {
  const env = loadEnv();
  const baseUrl = env.MAKERS_URL;
  if (!baseUrl) throw new Error('MAKERS_URL is not configured');

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) params.set(k, String(v));
  }

  const res = await axios.get(`${baseUrl}/iqc?${params.toString()}`, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    signal,
    headers: {
      'x-makers-secret': env.MAKERS_SECRET ?? '',
    },
  });

  const format = opts.format;
  const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;

  return {
    buffer: Buffer.from(res.data),
    mimeType: mimeMap[format],
    format,
  };
}

export async function generate(
  opts: IqcQuery,
  { signal }: { signal?: AbortSignal } = {},
): Promise<IqcResult> {
  if (opts.media) await assertPublicUrl(opts.media);

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderRemote(opts, signal)
    .then((result) => { cache.set(key, result); return result; })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export const iqcService = { generate, cache };