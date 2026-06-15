import { randomBytes } from 'node:crypto';

interface SpotifyEntry {
  filePath: string;
  filename: string;
  expiresAt: number;
}

const store = new Map<string, SpotifyEntry>();
const TTL_MS = 10 * 60 * 1000; // 10 menit

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt < now) store.delete(key);
  }
}, TTL_MS).unref();

export function storeSpotifyFile(filePath: string, filename: string): string {
  let id = randomBytes(6).toString('base64url');
  while (store.has(id)) id = randomBytes(6).toString('base64url');
  store.set(id, { filePath, filename, expiresAt: Date.now() + TTL_MS });
  return id;
}

export function getSpotifyFile(id: string): { filePath: string; filename: string } | null {
  const entry = store.get(id);
  if (!entry || entry.expiresAt < Date.now()) {
    store.delete(id);
    return null;
  }
  return { filePath: entry.filePath, filename: entry.filename };
}
