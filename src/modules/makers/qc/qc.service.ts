import axios from 'axios';
import { createHash } from 'node:crypto';
import { loadEnv } from '../../../config/env.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { QcQuery } from './qc.schemas.js';

export interface QcResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache<string, QcResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<QcResult>>();

function cacheKey(opts: QcQuery): string {
  const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

async function renderRemote(opts: QcQuery, signal?: AbortSignal): Promise<QcResult> {
  const env = loadEnv();
  const baseUrl = env.MAKERS_URL;
  if (!baseUrl) throw new Error('MAKERS_URL is not configured');

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) params.set(k, String(v));
  }

  const res = await axios.get(`${baseUrl}/qc?${params.toString()}`, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    signal,
    headers: { 'x-makers-secret': env.MAKERS_SECRET ?? '' },
  });

  const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' } as const;
  return { buffer: Buffer.from(res.data), mimeType: mimeMap[opts.format], format: opts.format };
}

export async function generate(opts: QcQuery, { signal }: { signal?: AbortSignal } = {}): Promise<QcResult> {
  if (opts.avatar) await assertPublicUrl(opts.avatar);

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

export const qcService = { generate, cache };