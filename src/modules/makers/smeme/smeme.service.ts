import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import sharp from 'sharp';
import { Internal, AppError } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { SmemeQuery } from './smeme.schemas.js';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_DURATION = 10;

// ── Font Anton (bundled di assets, sama seperti template HTML lama) ──────────
// Pola yang sama dengan brat.service.ts: register sekali saat module init.
// Tidak butuh Chromium, tidak butuh font sistem.

const FONT_FAMILY = 'SmemeAnton';
const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'anton.ttf');

try {
  GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
} catch {
  // fallback ke Impact / Arial / sans-serif di ctx.font
}

// Font emoji warna (Noto Color Emoji, ~24MB) — fallback per glyph: huruf
// pakai Anton, emoji pakai font ini. Tanpa font ini emoji hilang diam-diam.
const EMOJI_FONT_FAMILY = 'NotoColorEmoji';
const EMOJI_FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'NotoColorEmoji.ttf');

try {
  GlobalFonts.registerFromPath(EMOJI_FONT_PATH, EMOJI_FONT_FAMILY);
} catch {
  // tanpa font emoji, emoji tidak ter-render (perilaku lama)
}

export interface SmemeResult {
  buffer: Buffer;
  mimeType: 'image/jpeg' | 'image/gif' | 'video/mp4';
  format: 'jpeg' | 'gif' | 'mp4';
}

export interface SmemeGenerateOptions {
  signal?: AbortSignal;
  inputBuffer?: Buffer;
  inputMime?: string;
}

const CACHE_MAX    = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache    = new LruCache<string, SmemeResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<SmemeResult>>();

function cacheKey(opts: SmemeQuery, inputMime?: string): string {
  const sorted = Object.fromEntries(Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha1').update(JSON.stringify({ ...sorted, inputMime })).digest('hex');
}

function detectFormat(mime: string): 'jpeg' | 'gif' | 'mp4' {
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('mp4') || mime.includes('video') || mime.includes('webm')) return 'mp4';
  return 'jpeg';
}

function escapeFfmpegText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
}

// ── Image smeme via @napi-rs/canvas (tanpa Chromium) ─────────────────────────
// Menggantikan render HTML + screenshot Puppeteer. Layout meniru template
// lama: gambar fit dalam batas, teks atas/bawah uppercase, tengah, outline hitam.

const MAX_IMAGE_DIM = 1200; // cap sisi terpanjang output, tanpa upscale
const PADDING_CSS = 10;    // jarak teks dari tepi, dalam px

type CanvasCtx = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

/**
 * Word-wrap dengan ctx.measureText (pola yang sama dengan brat.service.ts).
 * Kata tunggal yang sendirian sudah lebih lebar dari maxWidth dipecah
 * per karakter, meniru `word-break: break-word` di CSS lama.
 */
function wrapText(ctx: CanvasCtx, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    while (ctx.measureText(word).width > maxWidth && word.length > 1) {
      let cut = 1;
      while (cut < word.length && ctx.measureText(word.slice(0, cut + 1)).width <= maxWidth) cut++;
      lines.push(word.slice(0, cut));
      word = word.slice(cut);
    }
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  };

  for (const word of words) pushWord(word);
  if (current) lines.push(current);
  return lines;
}

/**
 * Hitung font size dari panjang teks — tier yang sama dengan JS di
 * template HTML lama (base dari lebar natural gambar, clamp 40–200).
 */
function calcSize(len: number, baseFontSize: number): number {
  let size: number;
  if (len <= 4)       size = baseFontSize;         // 1 kata pendek
  else if (len <= 8)  size = baseFontSize * 0.85;  // 1-2 kata
  else if (len <= 14) size = baseFontSize * 0.72;  // 2-3 kata
  else if (len <= 22) size = baseFontSize * 0.60;  // 3-4 kata
  else if (len <= 35) size = baseFontSize * 0.50;  // 4-6 kata
  else if (len <= 55) size = baseFontSize * 0.42;  // kalimat panjang
  else                size = baseFontSize * 0.34;  // sangat panjang
  return Math.max(20, Math.min(baseFontSize, Math.round(size)));
}

async function renderImageSmeme(
  opts: SmemeQuery,
  imageBuffer: Buffer,
): Promise<SmemeResult> {
  let img;
  try {
    img = await loadImage(imageBuffer);
  } catch {
    throw new AppError(400, 'SMEME_INVALID_IMAGE', 'Could not decode image');
  }

  // Fit dalam 1200px tanpa upscale (gambar kecil tetap ukuran aslinya).
  const scale = Math.min(1, MAX_IMAGE_DIM / img.width, MAX_IMAGE_DIM / img.height);
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);

  // Font size: base dari lebar natural gambar, lalu tier per panjang teks,
  // pakai ukuran terkecil untuk semua blok biar konsisten (seperti template).
  const baseFontSize = Math.max(40, Math.min(200, Math.round(img.width * 0.20)));
  const sizes: number[] = [];
  if (opts.top) sizes.push(calcSize(opts.top.length, baseFontSize));
  if (opts.bottom) sizes.push(calcSize(opts.bottom.length, baseFontSize));
  const finalSizeCss = sizes.length ? Math.min(...sizes) : baseFontSize;
  const fontSize = finalSizeCss;
  const lineHeight = fontSize * 1.1;
  const padding = PADDING_CSS;
  const maxTextW = W - padding * 2;

  ctx.font = `${fontSize}px "${FONT_FAMILY}", "${EMOJI_FONT_FAMILY}", Impact, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // Outline hitam: strokeText + round join meniru -webkit-text-stroke 2px
  // + 8 text-shadow di CSS lama.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(2, Math.round(fontSize * 0.10));
  ctx.fillStyle = '#fff';

  const drawLines = (lines: string[], yTop: number) => {
    lines.forEach((line, i) => {
      const y = yTop + i * lineHeight;
      ctx.strokeText(line, W / 2, y);
      ctx.fillText(line, W / 2, y);
    });
  };

  if (opts.top) {
    drawLines(wrapText(ctx, opts.top.toUpperCase(), maxTextW), padding);
  }
  if (opts.bottom) {
    const lines = wrapText(ctx, opts.bottom.toUpperCase(), maxTextW);
    drawLines(lines, H - padding - lines.length * lineHeight);
  }

  const png = canvas.toBuffer('image/png');
  if (!png || png.length === 0) throw Internal('SMEME produced empty buffer');
  const buffer = await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: opts.quality }).toBuffer();
  return { buffer, mimeType: 'image/jpeg', format: 'jpeg' };
}

// ── Video/GIF smeme via ffmpeg ────────────────────────────────────────────────

async function renderVideoSmeme(
  opts: SmemeQuery,
  inputBuffer: Buffer,
  inputMime: string,
  signal?: AbortSignal,
): Promise<SmemeResult> {
  const format = detectFormat(inputMime);
  const uid = createHash('md5').update(Date.now().toString()).digest('hex').slice(0, 8);
  const ext = format === 'gif' ? '.gif' : inputMime.includes('webm') ? '.webm' : '.mp4';
  const inputPath = join(tmpdir(), `smeme_in_${uid}${ext}`);
  const outputPath = join(tmpdir(), `smeme_out_${uid}.${format}`);

  await writeFile(inputPath, inputBuffer);

  try {
    const fontPath = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf';
    const baseStyle = `fontfile=${fontPath}:fontsize=48:fontcolor=white:borderw=3:bordercolor=black:fix_bounds=1`;

    const textFilters: string[] = [];
    if (opts.top) textFilters.push(`drawtext=${baseStyle}:text='${escapeFfmpegText(opts.top)}':x=(w-text_w)/2:y=10`);
    if (opts.bottom) textFilters.push(`drawtext=${baseStyle}:text='${escapeFfmpegText(opts.bottom)}':x=(w-text_w)/2:y=h-text_h-10`);
    const vf = textFilters.join(',');

    let ffmpegArgs: string[];
    if (format === 'gif') {
      ffmpegArgs = [
        '-y', '-i', inputPath,
        '-t', String(MAX_VIDEO_DURATION),
        '-vf', `${vf},split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
        '-loop', '0',
        outputPath,
      ];
    } else {
      ffmpegArgs = [
        '-y', '-i', inputPath,
        '-t', String(MAX_VIDEO_DURATION),
        '-vf', vf,
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        '-an',
        outputPath,
      ];
    }

    await execFileAsync('ffmpeg', ffmpegArgs, { timeout: 60_000, signal });
    const buffer = await readFile(outputPath);
    const mimeType = format === 'gif' ? 'image/gif' : 'video/mp4';
    return { buffer, mimeType, format };
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function generate(
  opts: SmemeQuery,
  { signal, inputBuffer, inputMime }: SmemeGenerateOptions = {},
): Promise<SmemeResult> {
  // File upload atau URL video/GIF → ffmpeg path
  if (inputBuffer && inputMime) {
    const fmt = detectFormat(inputMime);
    if (fmt === 'gif' || fmt === 'mp4') {
      return renderVideoSmeme(opts, inputBuffer, inputMime, signal);
    }
    // Image upload → render via canvas langsung dari buffer
    return renderImageSmeme(opts, inputBuffer);
  }

  // URL input
  if (!opts.url) throw new AppError(400, 'SMEME_NO_INPUT', 'Provide ?url= or upload a file');
  const url = opts.url;
  await assertPublicUrl(url);

  // Detect apakah URL adalah video/GIF
  const headRes = await fetch(url, { method: 'HEAD', signal }).catch(() => null);
  const mime = headRes?.headers.get('content-type') ?? '';
  const fmt = detectFormat(mime);

  if (fmt === 'gif' || fmt === 'mp4') {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new AppError(400, 'SMEME_FETCH_FAILED', `Failed to fetch media: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return renderVideoSmeme(opts, buf, mime, signal);
  }

  // Image URL → canvas (dengan cache)
  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new AppError(400, 'SMEME_FETCH_FAILED', `Failed to fetch media: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return renderImageSmeme(opts, buf);
  })()
    .then((result) => { cache.set(key, result); return result; })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export const smemeService = { generate, cache };
