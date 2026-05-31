import { createHash } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fetch, Agent } from 'undici';
import sharp from 'sharp';
import { Internal, BadRequest } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import type { StickerSingleQuery, StickerPackQuery } from './sticker.schemas.js';

// Force IPv4 — undici punya DNS resolver sendiri, tidak ikut setDefaultResultOrder
const ipv4Agent = new Agent({ connect: { family: 4 } });

// archiver tidak support ESM default export
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiverLib = require('archiver');

// ─── Types ────────────────────────────────────────────────────────────────────
export interface StickerSingleResult {
  buffer: Buffer;
  mimeType: string;
  format: string;
  isAnimated: boolean;
}

export interface StickerPackResult {
  filePath: string;
  mimeType: 'application/zip';
  filename: string;
}

export interface StickerOptions {
  signal?: AbortSignal;
}

// ─── Telegram API ─────────────────────────────────────────────────────────────
const TG_API = (token: string) => `https://api.telegram.org/bot${token}`;
const TG_FILE = (token: string) => `https://api.telegram.org/file/bot${token}`;

function getToken(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw Internal('TELEGRAM_BOT_TOKEN is not set');
  return t;
}

// Extract pack name from t.me link or return as-is (file_id)
function extractPackName(input: string): string | null {
  const m = /t\.me\/addstickers\/([A-Za-z0-9_]+)/i.exec(input);
  return m ? m[1] : null;
}

// ─── Telegram API helpers ─────────────────────────────────────────────────────
async function tgGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const res = await fetch(`${TG_API(token)}${path}`, { signal, dispatcher: ipv4Agent } as any);
  const json = await res.json() as { ok: boolean; result?: T; description?: string };
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
  file_size?: number;
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

// ─── Image conversion ─────────────────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  jpeg: 'image/jpeg',
  png:  'image/png',
  webp: 'image/webp',
};

async function convertSticker(
  buf: Buffer,
  format: 'jpeg' | 'png' | 'webp',
  quality: number,
  size?: number,
): Promise<Buffer> {
  let s = sharp(buf);
  if (size) s = s.resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } });
  if (format === 'jpeg') return s.flatten({ background: '#ffffff' }).jpeg({ quality }).toBuffer();
  if (format === 'webp') return s.webp({ quality, effort: 3 }).toBuffer();
  return s.png().toBuffer();
}

// ─── Cache ────────────────────────────────────────────────────────────────────
const CACHE_MAX    = 100;
const CACHE_TTL_MS = 30 * 60 * 1000;
const singleCache = new LruCache<string, StickerSingleResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const packCache   = new LruCache<string, StickerPackResult>({ max: 50, ttlMs: CACHE_TTL_MS });

function cacheKey(opts: Record<string, unknown>): string {
  const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

// ─── Single sticker ───────────────────────────────────────────────────────────
export async function generateSingle(
  opts: StickerSingleQuery,
  { signal }: StickerOptions = {},
): Promise<StickerSingleResult> {
  const key = cacheKey(opts as unknown as Record<string, unknown>);
  const cached = singleCache.get(key);
  if (cached) return cached;

  // Resolve file_id — input bisa berupa link pack atau file_id langsung
  const packName = extractPackName(opts.input);
  let fileId = opts.input;

  if (packName) {
    // Ambil sticker pertama dari pack
    const set = await getStickerSet(packName, signal);
    if (!set.stickers.length) throw BadRequest('Sticker pack is empty');
    fileId = set.stickers[0].file_id;
  }

  // Get file info
  const fileInfo = await getFileInfo(fileId, signal);
  if (!fileInfo.file_path) throw Internal('Telegram did not return file path');

  const isAnimated = fileInfo.file_path.endsWith('.tgs') || fileInfo.file_path.endsWith('.webm');

  // Download
  const raw = await downloadTgFile(fileInfo.file_path, signal);

  let buffer: Buffer;
  let mimeType: string;
  let format: string;

  if (isAnimated) {
    // Return as-is WebP animated / TGS
    buffer   = raw;
    mimeType = 'image/webp';
    format   = 'webp';
  } else {
    buffer   = await convertSticker(raw, opts.format, opts.quality);
    mimeType = MIME_MAP[opts.format];
    format   = opts.format;
  }

  const result: StickerSingleResult = { buffer, mimeType, format, isAnimated };
  singleCache.set(key, result);
  return result;
}

// ─── Pack ─────────────────────────────────────────────────────────────────────
export async function generatePack(
  opts: StickerPackQuery,
  authorName: string,
  { signal }: StickerOptions = {},
): Promise<StickerPackResult> {
  const key = cacheKey({ ...opts as unknown as Record<string, unknown>, authorName });
  const cached = packCache.get(key);
  if (cached) return cached;

  const packName = extractPackName(opts.input);
  if (!packName) throw BadRequest('Pack input must be a t.me/addstickers/<name> link');

  const set = await getStickerSet(packName, signal);
  if (!set.stickers.length) throw BadRequest('Sticker pack is empty');

  const isWastickers = opts.format === 'wastickers';
  const ext = isWastickers ? 'wastickers' : 'zip';
  const filename = `${set.name}.${ext}`;

  // Tmp dir
  const tmpDir = join(tmpdir(), `sticker-${createHash('sha1').update(key).digest('hex').slice(0, 8)}`);
  await mkdir(tmpDir, { recursive: true });
  const outPath = join(tmpDir, filename);

  try {
    await new Promise<void>(async (resolve, reject) => {
      const output = createWriteStream(outPath);
      const archive = new archiverLib.ZipArchive({ zlib: { level: 6 } });

      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);

      if (isWastickers) {
        // wastickers spec: title.txt, author.txt, icon.png, 01.webp … NN.webp
        const domain = process.env.APP_DOMAIN ?? 'rex-api.xyz';
        archive.append(`${set.title} • ${domain}`, { name: 'title.txt' });
        archive.append(authorName, { name: 'author.txt' });
      }

      // Process stickers
      let iconBuf: Buffer | null = null;
      let idx = 1;

      for (const sticker of set.stickers) {
        if (signal?.aborted) { archive.abort(); return reject(new DOMException('Aborted', 'AbortError')); }

        try {
          const fileInfo = await getFileInfo(sticker.file_id, signal);
          if (!fileInfo.file_path) continue;

          const isAnimated = fileInfo.file_path.endsWith('.tgs') || fileInfo.file_path.endsWith('.webm');
          const raw = await downloadTgFile(fileInfo.file_path, signal);

          let buf: Buffer;
          let entryName: string;

          if (isWastickers) {
            // WA sticker: harus 512x512 WebP
            if (isAnimated) {
              // Skip animated untuk wastickers karena butuh lottie renderer
              continue;
            }
            buf = await convertSticker(raw, 'webp', opts.quality, 512);
            entryName = `${String(idx).padStart(2, '0')}.webp`;

            // Pakai sticker pertama sebagai icon (96x96 PNG)
            if (!iconBuf) {
              iconBuf = await sharp(raw)
                .resize(96, 96, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
              archive.append(iconBuf, { name: 'icon.png' });
            }
          } else {
            // ZIP biasa
            if (isAnimated) {
              buf = raw;
              entryName = `${String(idx).padStart(2, '0')}.webp`;
            } else {
              buf = await convertSticker(raw, opts.image_format, opts.quality);
              const imgExt = opts.image_format === 'jpeg' ? 'jpg' : opts.image_format;
              entryName = `${String(idx).padStart(2, '0')}.${imgExt}`;
            }
          }

          archive.append(buf, { name: entryName });
          idx++;
        } catch {
          // Skip sticker yang gagal didownload
          continue;
        }
      }

      await archive.finalize();
    });

    const result: StickerPackResult = {
      filePath: outPath,
      mimeType: 'application/zip',
      filename,
    };

    // Simpan mapping filename → filePath untuk lookup di route
    fileRegistry.set(filename, outPath);

    packCache.set(key, result);
    return result;
  } catch (err) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// Registry untuk lookup filePath dari filename
const fileRegistry = new Map<string, string>();

export function lookupFile(filename: string): string | null {
  return fileRegistry.get(filename) ?? null;
}

export const stickerService = { generateSingle, generatePack, lookupFile };