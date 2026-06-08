import { GoogleGenAI } from '@google/genai';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../config/env.js';

/**
 * Round-robin Gemini API key rotator.
 * Baca GEMINI_API_KEYS dari env (comma-separated).
 * Kalau satu key kena rate limit (429), otomatis coba key berikutnya.
 */

let keys: string[] = [];
let currentIndex = 0;

function loadKeys(): string[] {
  if (keys.length > 0) return keys;
  const env = loadEnv();
  const raw = env.GEMINI_API_KEYS ?? '';
  keys = raw.split(',').map((k: string) => k.trim()).filter(Boolean);
  if (keys.length === 0) throw new AppError(503, 'GEMINI_NOT_CONFIGURED', 'GEMINI_API_KEYS belum di-set di environment');
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
  return status === 429 || msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
}

/**
 * Jalankan callback dengan Gemini client.
 * Otomatis retry dengan key berikutnya kalau kena rate limit.
 */
export async function withGemini<T>(fn: (ai: GoogleGenAI) => Promise<T>): Promise<T> {
  const allKeys = loadKeys();
  let lastError: unknown;

  for (let attempt = 0; attempt < allKeys.length; attempt++) {
    const key = nextKey();
    const ai = new GoogleGenAI({ apiKey: key });
    try {
      return await fn(ai);
    } catch (err) {
      console.error(`[gemini] key #${attempt + 1} error:`, {
        message: (err as any)?.message,
        status: (err as any)?.status ?? (err as any)?.statusCode,
        details: JSON.stringify((err as any)?.errorDetails ?? (err as any)?.body ?? '').slice(0, 300),
      });
      if (isRateLimitError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  throw new AppError(429, 'GEMINI_ALL_KEYS_EXHAUSTED', `Semua Gemini API key kena rate limit (${allKeys.length} key)`);
}