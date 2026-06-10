import Groq from 'groq-sdk';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../config/env.js';

let keys: string[] = [];
let currentIndex = 0;

function loadKeys(): string[] {
  if (keys.length > 0) return keys;
  const env = loadEnv();
  const raw = env.GROQ_API_KEYS ?? '';
  keys = raw.split(',').map((k: string) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new AppError(503, 'GROQ_NOT_CONFIGURED', 'GROQ_API_KEYS belum di-set di environment');
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

export async function withGroq<T>(fn: (client: Groq) => Promise<T>): Promise<T> {
  const allKeys = loadKeys();
  let lastError: unknown;

  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const client = new Groq({ apiKey: nextKey() });
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

  throw new AppError(429, 'GROQ_ALL_KEYS_EXHAUSTED', `Semua Groq API key kena rate limit (${allKeys.length} key)`);
}
