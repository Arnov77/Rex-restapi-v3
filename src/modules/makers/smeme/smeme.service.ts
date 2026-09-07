import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { withPage } from '@shared/browser/browserManager.js';
import { Internal, AppError } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { SmemeQuery } from './smeme.schemas.js';
import { renderSmemeHtml } from './smeme.template.js';

const execFileAsync = promisify(execFile);
const MAX_VIDEO_DURATION = 10;

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

// ── Image smeme via Puppeteer ─────────────────────────────────────────────────

async function renderImageSmeme(
  opts: SmemeQuery,
  imageUrl: string,
  signal?: AbortSignal,
): Promise<SmemeResult> {
  const html = renderSmemeHtml({ ...opts, image: imageUrl, format: 'jpeg' });

  const png = await withPage(
    async (page) => {
      await page.setContent(html, { waitUntil: 'load', timeout: 15_000 });
      await page
        .waitForFunction("document.documentElement.dataset['ready'] === '1'", undefined, { timeout: 5_000 })
        .catch(() => {});
      const el = await page.$('#canvas');
      if (!el) throw Internal('SMEME canvas element not found');
      return el.screenshot({ type: 'png' });
    },
    { viewport: { width: 900, height: 900 }, deviceScaleFactor: 2, signal },
  );

  if (!png || png.length === 0) throw Internal('SMEME produced empty buffer');
  let buffer: Buffer = Buffer.isBuffer(png) ? png : Buffer.from(png);
  buffer = await sharp(buffer).flatten({ background: '#ffffff' }).jpeg({ quality: opts.quality }).toBuffer();
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
    // Image upload → render via Puppeteer dengan data URI
    const b64 = inputBuffer.toString('base64');
    const dataUri = `data:${inputMime};base64,${b64}`;
    return renderImageSmeme(opts, dataUri, signal);
  }

  // URL input
  if (!opts.url) throw new AppError(400, 'SMEME_NO_INPUT', 'Provide ?url= or upload a file');
  await assertPublicUrl(opts.url);

  // Detect apakah URL adalah video/GIF
  const headRes = await fetch(opts.url, { method: 'HEAD', signal }).catch(() => null);
  const mime = headRes?.headers.get('content-type') ?? '';
  const fmt = detectFormat(mime);

  if (fmt === 'gif' || fmt === 'mp4') {
    const res = await fetch(opts.url, { signal });
    if (!res.ok) throw new AppError(400, 'SMEME_FETCH_FAILED', `Failed to fetch media: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return renderVideoSmeme(opts, buf, mime, signal);
  }

  // Image URL → Puppeteer (dengan cache)
  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderImageSmeme(opts, opts.url, signal)
    .then((result) => { cache.set(key, result); return result; })
    .finally(() => inflight.delete(key));

  inflight.set(key, promise);
  return promise;
}

export const smemeService = { generate, cache };
