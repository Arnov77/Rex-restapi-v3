import { AppError } from '@shared/errors.js';
import { loadEnv } from '../config/env.js';

/**
 * Round-robin SerpAPI key rotator.
 * Baca SERPAPI_KEYS dari env (comma-separated).
 * Kalau satu key kena rate limit/forbidden/error sementara, otomatis coba key berikutnya.
 */

let keys: string[] = [];
let currentIndex = 0;

function loadKeys(): string[] {
  if (keys.length > 0) return keys;

  const env = loadEnv();
  const raw = env.SERPAPI_KEYS ?? env.SERPAPI_KEY ?? '';

  keys = raw
    .split(',')
    .map((k: string) => k.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new AppError(503, 'SERPAPI_NOT_CONFIGURED', 'SERPAPI_KEYS belum di-set di environment');
  }

  return keys;
}

function nextKey(): string {
  const k = loadKeys();
  const key = k[currentIndex % k.length]!;
  currentIndex = (currentIndex + 1) % k.length;
  return key;
}

function isRetryableSerpApiError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? '').toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? 0;

  return (
    status === 401 ||
    status === 403 ||
    status === 429 ||
    status >= 500 ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('rate limit') ||
    msg.includes('exhausted')
  );
}

/**
 * Jalankan callback dengan SerpAPI key.
 * Otomatis retry dengan key berikutnya kalau key sekarang limit/forbidden/error sementara.
 */
export async function withSerpApi<T>(fn: (apiKey: string) => Promise<T>): Promise<T> {
  const allKeys = loadKeys();

  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const key = nextKey();

    try {
      return await fn(key);
    } catch (err) {
      console.error(`[serpapi] key #${attempt + 1} error:`, {
        message: (err as any)?.message,
        status: (err as any)?.status ?? (err as any)?.statusCode,
        details: JSON.stringify((err as any)?.body ?? '').slice(0, 300),
      });

      if (isRetryableSerpApiError(err)) continue;
      throw err;
    }
  }

  throw new AppError(429, 'SERPAPI_ALL_KEYS_EXHAUSTED', `Semua SerpAPI key gagal atau kena limit (${allKeys.length} key)`);
}
