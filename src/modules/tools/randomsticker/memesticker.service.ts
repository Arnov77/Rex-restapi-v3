import { fetch, Agent } from 'undici';
import sharp from 'sharp';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Internal, BadRequest } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { memeStickerPacksRepo } from './randomsticker.repo.js';
import type { MemeStickerQuery } from './memesticker.schemas.js';

const ipv4Agent = new Agent({ connect: { family: 4 } });

// ─── Pack list ──
const packListCache = new LruCache<'active', string[]>({ max: 1, ttlMs: 60 * 1000 });

async function loadActivePacks(db: SupabaseClient): Promise<string[]> {
  const cached = packListCache.get('active');
  if (cached) return cached;
  const names = await memeStickerPacksRepo(db).listActiveNames();
  packListCache.set('active', names);
  return names;
}

export function invalidatePackListCache(): void {
  packListCache.clear();
}

const TG_API = (token: string) => `https://api.telegram.org/bot${token}`;
const TG_FILE = (token: string) => `https://api.telegram.org/file/bot${token}`;

function getToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw Internal('TELEGRAM_BOT_TOKEN is not set');
  return t;
}

async function tgGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const res = await fetch(`${TG_API(token)}${path}`, { signal, dispatcher: ipv4Agent } as any);
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw BadRequest(`Telegram API error: ${json.description ?? 'unknown'}`);
  return json.result as T;
}

async function downloadTgFile(filePath: string, signal?: AbortSignal): Promise<Buffer> {
  const token = getToken();
  const res = await fetch(`${TG_FILE(token)}/${filePath}`, { signal, dispatcher: ipv4Agent } as any);
  if (!res.ok) throw Internal(`Failed to download Telegram file: ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

interface TgFile { file_id: string; file_path?: string; }
interface TgSticker {
  file_id: string;
  file_unique_id: string;
  is_animated: boolean;
  is_video: boolean;
  width: number;
  height: number;
}
interface TgStickerSet {
  name: string;
  title: string;
  stickers: TgSticker[];
}

async function getFileInfo(fileId: string, signal?: AbortSignal): Promise<TgFile> {
  return tgGet<TgFile>(`/getFile?file_id=${encodeURIComponent(fileId)}`, signal);
}

async function getStickerSet(name: string, signal?: AbortSignal): Promise<TgStickerSet> {
  return tgGet<TgStickerSet>(`/getStickerSet?name=${encodeURIComponent(name)}`, signal);
}

const MIME_MAP: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

async function convertSticker(buf: Buffer, format: 'jpeg' | 'png' | 'webp', quality: number): Promise<Buffer> {
  const s = sharp(buf);
  if (format === 'jpeg') return s.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
  if (format === 'webp') return s.webp({ quality, effort: 3 }).toBuffer();
  return s.png().toBuffer();
}

// Cache daftar sticker per pack supaya tidak hit Telegram API tiap request
const packSetCache = new LruCache<string, TgStickerSet>({ max: 50, ttlMs: 10 * 60 * 1000 });

async function resolveStickerSet(name: string, signal?: AbortSignal): Promise<TgStickerSet> {
  const cached = packSetCache.get(name);
  if (cached) return cached;
  const set = await getStickerSet(name, signal);
  if (!set.stickers.length) throw BadRequest(`Pack "${name}" is empty`);
  packSetCache.set(name, set);
  return set;
}

function pickRandom<T>(arr: T[]): T {
  const item = arr[Math.floor(Math.random() * arr.length)];
  if (item === undefined) throw Internal('pickRandom called on empty array');
  return item;
}

export interface MemeStickerResult {
  buffer: Buffer;
  mimeType: string;
  format: string;
  isAnimated: boolean;
  pack: string;
}

export async function getRandomMemeSticker(
  db: SupabaseClient,
  opts: MemeStickerQuery,
  signal?: AbortSignal,
): Promise<MemeStickerResult> {
  const packs = await loadActivePacks(db);
  if (!packs.length) {
    throw Internal('No active meme sticker packs configured. Add one via /api/admin/memesticker/packs.');
  }

  const packName = opts.pack ?? pickRandom(packs);
  if (opts.pack && !packs.includes(opts.pack)) {
    throw BadRequest(`Unknown or inactive pack "${opts.pack}". Allowed: ${packs.join(', ')}`);
  }

  const set = await resolveStickerSet(packName, signal);
  const sticker = pickRandom(set.stickers);

  const fileInfo = await getFileInfo(sticker.file_id, signal);
  if (!fileInfo.file_path) throw Internal('Telegram did not return file path');

  const isAnimated = fileInfo.file_path.endsWith('.tgs') || fileInfo.file_path.endsWith('.webm');
  const raw = await downloadTgFile(fileInfo.file_path, signal);

  if (isAnimated) {
    return { buffer: raw, mimeType: 'image/webp', format: 'webp', isAnimated: true, pack: packName };
  }

  const buffer = await convertSticker(raw, opts.format, opts.quality);
  return {
    buffer,
    mimeType: MIME_MAP[opts.format] ?? 'image/webp',
    format: opts.format,
    isAnimated: false,
    pack: packName,
  };
}

export const memeStickerService = { getRandomMemeSticker, invalidatePackListCache };
