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

/**
 * Error yang layak di-retry dengan key lain atau setelah delay singkat.
 * - 429: rate limit / quota habis
 * - 503: model overloaded / unavailable sementara
 * - 500: internal server error Gemini (kadang transient)
 */
function isRetryableError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? '').toLowerCase();
  const status = Number((err as any)?.status ?? (err as any)?.statusCode ?? 0);

  if ([429, 500, 503].includes(status)) return true;
  if (msg.includes('429') || msg.includes('quota') || msg.includes('rate limit')) return true;
  if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) return true;
  if (msg.includes('500') || msg.includes('internal server error')) return true;
  if (msg.includes('denied') || msg.includes('403')) return true;

  return false;
}

/**
 * Jalankan callback dengan Gemini client.
 * Otomatis retry dengan key berikutnya kalau kena error yang bisa di-retry (429, 500, 503).
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
      const status = (err as any)?.status ?? (err as any)?.statusCode;
      console.error(`[gemini] key #${attempt + 1} error:`, {
        message: (err as any)?.message,
        status,
        details: JSON.stringify((err as any)?.errorDetails ?? (err as any)?.body ?? '').slice(0, 300),
      });
      if (isRetryableError(err)) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  const lastStatus = (lastError as any)?.status ?? (lastError as any)?.statusCode ?? 429;
  const lastMsg = String((lastError as any)?.message ?? '').toLowerCase();
  const isOverloaded = lastStatus === 503 || lastMsg.includes('unavailable') || lastMsg.includes('overloaded');

  throw new AppError(
    isOverloaded ? 503 : 429,
    isOverloaded ? 'GEMINI_OVERLOADED' : 'GEMINI_ALL_KEYS_EXHAUSTED',
    isOverloaded
      ? 'Model Gemini sedang overload, coba lagi dalam beberapa saat'
      : `Semua Gemini API key kena rate limit (${allKeys.length} key)`,
  );
}