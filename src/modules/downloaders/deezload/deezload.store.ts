import { unlinkSync, existsSync } from 'node:fs';
import { LruCache } from '@shared/utils/lruCache.js';

const TTL_MS = 60 * 60 * 1000; // 1 jam

export interface DeezloadEntry {
  filePath: string;
  fileName: string;
  title: string | null;
  description: string | null;
  expiresAt: number;
}

export const cache = new LruCache<string, DeezloadEntry>({ max: 100, ttlMs: TTL_MS });
export const inflight = new Map<string, Promise<DeezloadEntry>>();

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Track file paths untuk cleanup — LruCache tidak bisa diiterasi
const trackedFiles = new Map<string, number>(); // filePath → expiresAt

export function trackFile(filePath: string): void {
  trackedFiles.set(filePath, Date.now() + TTL_MS);
}

// Hapus file lokal yang sudah expired setiap 10 menit
setInterval(() => {
  const now = Date.now();
  for (const [filePath, expiresAt] of trackedFiles) {
    if (expiresAt <= now) {
      trackedFiles.delete(filePath);
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch { /* ignore */ }
    }
  }
}, 10 * 60 * 1000).unref();