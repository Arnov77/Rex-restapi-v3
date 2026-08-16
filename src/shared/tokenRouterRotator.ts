import OpenAI from 'openai';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../config/env.js';

let keys: string[] = [];
let currentIndex = 0;

function loadKeys(): string[] {
  if (keys.length > 0) return keys;
  const env = loadEnv();
  const raw = env.TOKENROUTER_API_KEYS ?? '';
  keys = raw.split(',').map((k: string) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new AppError(503, 'TOKENROUTER_NOT_CONFIGURED', 'TOKENROUTER_API_KEYS belum di-set di environment');
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

export async function withTokenRouter<T>(fn: (client: OpenAI) => Promise<T>): Promise<T> {
  const allKeys = loadKeys();
  let lastError: unknown;
  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const client = new OpenAI({
      apiKey: nextKey(),
      baseURL: 'https://api.tokenrouter.com/v1',
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
  throw new AppError(429, 'TOKENROUTER_ALL_KEYS_EXHAUSTED', `Semua TokenRouter API key kena rate limit (${allKeys.length} key)`);
}
