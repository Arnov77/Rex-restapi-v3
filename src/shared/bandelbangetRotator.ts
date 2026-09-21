import OpenAI from 'openai';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../config/env.js';

let keys: string[] = [];
let currentIndex = 0;

function loadKeys(): string[] {
  if (keys.length > 0) return keys;
  const env = loadEnv();
  const raw = env.BANDELBANGET_API_KEYS ?? '';
  keys = raw.split(',').map((k: string) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new AppError(503, 'BANDELBANGET_NOT_CONFIGURED', 'BANDELBANGET_API_KEYS belum di-set di environment');
  return keys;
}

function nextKey(): string {
  const k = loadKeys();
  const key = k[currentIndex % k.length]!;
  currentIndex = (currentIndex + 1) % k.length;
  return key;
}

function isRateLimitError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? '').toLowerCase();
  const status = (err as any)?.status ?? (err as any)?.statusCode ?? 0;
  return status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('quota');
}

export async function withBandelbanget<T>(fn: (client: OpenAI) => Promise<T>): Promise<T> {
  const allKeys = loadKeys();
  let lastError: unknown;
  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const client = new OpenAI({
      apiKey: nextKey(),
      baseURL: 'https://bandelbanget.xyz/v1',
    });
    try {
      return await fn(client);
    } catch (err) {
      if (isRateLimitError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }
  throw new AppError(429, 'BANDELBANGET_ALL_KEYS_EXHAUSTED', `Semua Bandelbanget API key kena rate limit (${allKeys.length} key)`);
}
