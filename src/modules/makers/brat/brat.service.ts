import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import sharp from 'sharp';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import { Internal } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import type { BratQuery } from './brat.schemas.js';

export interface BratResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  format: 'png' | 'jpeg' | 'gif' | 'webp';
}

export interface GenerateOptions {
  signal?: AbortSignal;
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

const FONT_FAMILY = 'BratArialNarrow';
const FONT_PATH = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'arialnarrow.ttf');

// Register font once at module init
try {
  GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
} catch {
  // fallback to system Arial Narrow / Arial
}

// ─── Cache ────────────────────────────────────────────────────────────────────

const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new LruCache<string, BratResult>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });
const inflight = new Map<string, Promise<BratResult>>();

function cacheKey(opts: BratQuery): string {
  const sorted = Object.fromEntries(
    Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)),
  );
  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

// ─── Text fitting ─────────────────────────────────────────────────────────────

/**
 * Find the largest font size (px) where the text fits within (maxW x maxH).
 * Mirrors the brat HTML shrink-to-fit loop logic.
 */
function fitFontSize(
  text: string,
  maxW: number,
  maxH: number,
  startSize: number,
): number {
  const canvas = createCanvas(maxW, maxH);
  const ctx = canvas.getContext('2d');

  let size = startSize;
  for (let i = 0; i < 80; i++) {
    ctx.font = `400 ${size}px "${FONT_FAMILY}", "Arial Narrow", Arial, sans-serif`;

    // Wrap text manually and measure total height
    const lines = wrapText(ctx, text, maxW);
    const lineHeight = size * 1.2;
    const totalHeight = lines.length * lineHeight;
    const maxLineWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));

    if (totalHeight <= maxH && maxLineWidth <= maxW) break;
    size = Math.max(10, size - Math.ceil(size * 0.05));
  }
  return size;
}

/**
 * Word-wrap text to fit within maxWidth, returns array of lines.
 */
function wrapText(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  text: string,
  maxWidth: number,
): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ─── Single frame renderer ────────────────────────────────────────────────────

async function renderFrame(
  opts: BratQuery,
  text: string,
  bgImageBuffer?: Buffer,
): Promise<Buffer> {
  const { width, height, background, color, blur } = opts;

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  // Background image
  if (bgImageBuffer) {
    const img = await loadImage(bgImageBuffer);
    // cover: scale to fill, center crop
    const scale = Math.max(width / img.width, height / img.height);
    const sw = img.width * scale;
    const sh = img.height * scale;
    const sx = (width - sw) / 2;
    const sy = (height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh);
  }

  // Font size auto-fit (start at 25% of width, same as HTML template)
  const startSize = Math.round(width * 0.25);
  const fontSize = fitFontSize(text, width, height, startSize);

  ctx.font = `400 ${fontSize}px "${FONT_FAMILY}", "Arial Narrow", Arial, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  // Draw wrapped lines
  const lines = wrapText(ctx, text, width);
  const lineHeight = fontSize * 1.2;
  const totalHeight = lines.length * lineHeight;
  const startY = (height - totalHeight) / 2;

  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i]!, 0, startY + i * lineHeight);
  }

  // Export as PNG buffer for further processing (blur, format conversion)
  const png = canvas.toBuffer('image/png');

  // Apply blur via sharp if requested
  if (blur > 0) {
    // sharp sigma: blur px maps roughly 1:1 for small values
    const sigma = Math.max(0.3, blur * 0.8);
    return sharp(png).blur(sigma).toBuffer();
  }

  return png;
}

// ─── GIF / WebP helpers ───────────────────────────────────────────────────────

function encodeGif(opts: BratQuery, frames: Buffer[], holdMs: number): Buffer {
  const enc = GIFEncoder();
  let sharedPalette: number[][] | null = null;

  for (let i = 0; i < frames.length; i++) {
    // pngjs-free: use sharp to get raw RGBA
    const raw = new Uint8ClampedArray(frames[i]!.buffer);
    if (!sharedPalette) sharedPalette = quantize(raw, 64, { format: 'rgb444' });
    const indexed = applyPalette(raw, sharedPalette, 'rgb444');
    const isLast = i === frames.length - 1;
    enc.writeFrame(indexed, opts.width, opts.height, {
      palette: i === 0 ? sharedPalette : undefined,
      delay: isLast ? holdMs : opts.delay,
    });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

async function encodeWebp(opts: BratQuery, frames: Buffer[], holdMs: number): Promise<Buffer> {
  const delay = frames.map((_, i) => (i === frames.length - 1 ? holdMs : opts.delay));
  return sharp(frames, { join: { animated: true } })
    .webp({ quality: opts.quality, effort: 3, loop: 0, delay })
    .toBuffer();
}

// ─── Raw RGBA from PNG buffer ─────────────────────────────────────────────────

async function toRgba(png: Buffer): Promise<Uint8ClampedArray> {
  const raw = await sharp(png).ensureAlpha().raw().toBuffer();
  return new Uint8ClampedArray(raw.buffer);
}

// ─── Generate still ───────────────────────────────────────────────────────────

async function generateStill(opts: BratQuery, bgImageBuffer?: Buffer): Promise<BratResult> {
  const png = await renderFrame(opts, opts.text, bgImageBuffer);

  let buffer: Buffer;
  if (opts.format === 'jpeg') {
    buffer = await sharp(png).jpeg({ quality: opts.quality }).toBuffer();
  } else if (opts.format === 'webp') {
    buffer = await sharp(png).webp({ quality: opts.quality, effort: 3 }).toBuffer();
  } else {
    buffer = png;
  }

  if (!buffer || buffer.length === 0) throw Internal('Brat produced an empty buffer');
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

// ─── Generate animated ────────────────────────────────────────────────────────

async function generateAnimated(opts: BratQuery, bgImageBuffer?: Buffer): Promise<BratResult> {
  const words = opts.text.split(/\s+/).filter(Boolean);
  const frameCount = Math.max(1, Math.min(words.length, 30));
  const HOLD_MS = 1200;

  const frames: Buffer[] = [];
  for (let i = 0; i < frameCount; i++) {
    const partial = words.slice(0, i + 1).join(' ');
    const png = await renderFrame(opts, partial, bgImageBuffer);
    if (!png || png.length === 0) throw Internal('Brat frame produced empty buffer');
    frames.push(png);
  }

  let buffer: Buffer;
  if (opts.format === 'webp') {
    buffer = await encodeWebp(opts, frames, HOLD_MS);
  } else {
    // GIF needs raw RGBA
    const rgbaFrames = await Promise.all(frames.map(toRgba));
    const enc = GIFEncoder();
    let sharedPalette: number[][] | null = null;
    for (let i = 0; i < rgbaFrames.length; i++) {
      const rgba = rgbaFrames[i]!;
      if (!sharedPalette) sharedPalette = quantize(rgba, 64, { format: 'rgb444' });
      const indexed = applyPalette(rgba, sharedPalette, 'rgb444');
      const isLast = i === rgbaFrames.length - 1;
      enc.writeFrame(indexed, opts.width, opts.height, {
        palette: i === 0 ? sharedPalette : undefined,
        delay: isLast ? HOLD_MS : opts.delay,
      });
    }
    enc.finish();
    buffer = Buffer.from(enc.bytes());
  }

  if (!buffer || buffer.length === 0) throw Internal('Brat animation produced empty buffer');
  return { buffer, mimeType: MIME[opts.format], format: opts.format };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function generate(opts: BratQuery, { signal: _signal }: GenerateOptions = {}): Promise<BratResult> {
  if (opts.bgImage) await assertPublicUrl(opts.bgImage);

  const key = cacheKey(opts);
  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  // Pre-fetch bgImage buffer once (if provided) so we don't re-fetch per frame
  let bgImageBuffer: Buffer | undefined;
  if (opts.bgImage) {
    const res = await fetch(opts.bgImage);
    bgImageBuffer = Buffer.from(await res.arrayBuffer());
  }

  const animated = opts.format === 'gif' || opts.format === 'webp';
  const isMulti = animated && /\s/.test(opts.text.trim());

  const promise = (isMulti ? generateAnimated(opts, bgImageBuffer) : generateStill(opts, bgImageBuffer))
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
}

export const bratService = { generate, cache };