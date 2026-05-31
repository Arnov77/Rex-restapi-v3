import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { Internal } from '@shared/errors.js';
import { LruCache } from '@shared/utils/lruCache.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import type { LqQuery } from './lq.schemas.js';

export interface LqResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  format: 'png' | 'jpeg' | 'webp';
}

export interface LqGenerateOptions {
  signal?: AbortSignal;
}

const MIME = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const;

const CACHE_MAX = 200;
const CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new LruCache<string, LqResult>({
  max: CACHE_MAX,
  ttlMs: CACHE_TTL_MS,
});

const inflight = new Map<string, Promise<LqResult>>();

function cacheKey(opts: LqQuery): string {
  const sorted = Object.fromEntries(
    Object.entries(opts).sort(([a], [b]) => a.localeCompare(b)),
  );

  return createHash('sha1').update(JSON.stringify(sorted)).digest('hex');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Efek LQ ini bukan pixelated dan bukan blur tebal.
 *
 * Konsep:
 * - gambar dikecilkan drastis
 * - sedikit smoothing supaya tidak kotak-kotak
 * - dibesarkan lagi
 * - dikompres ulang
 *
 * Hasilnya jadi seperti:
 * "foto resolusi kecil yang dipaksa jadi besar"
 */
function getLqParams(level: number, userQuality: number) {
  const normalized = clamp(level, 1, 15);

  /**
   * Scale adalah bagian paling penting.
   *
   * Semakin kecil scale, semakin hancur detailnya.
   * Tapi karena nanti upscale pakai kernel smooth,
   * hasilnya tidak jadi pixel kotak-kotak.
   */
  const scale = clamp(0.28 - normalized * 0.0155, 0.035, 0.28);

  /**
   * Blur hanya ringan.
   * Tujuannya cuma menghilangkan tepi kasar setelah downscale,
   * bukan membuat gambar jadi blur total.
   */
  const softBlur = clamp(0.12 + normalized * 0.055, 0.12, 0.95);

  /**
   * JPEG quality internal.
   * Ini tetap dikontrol juga oleh query quality user.
   */
  const internalQuality = clamp(Math.round(82 - normalized * 3.4), 10, 82);

  /**
   * Final quality adalah gabungan dari quality user dan level.
   */
  const finalQuality = clamp(
    Math.min(userQuality, internalQuality),
    8,
    95,
  );

  /**
   * Warna sedikit dikusamkan supaya feel low quality lebih masuk.
   */
  const saturation = clamp(1 - normalized * 0.022, 0.62, 1);

  /**
   * Brightness kecil saja.
   * Jangan terlalu tinggi supaya gambar tidak washed out.
   */
  const brightness = clamp(1.015 - normalized * 0.001, 1, 1.015);

  /**
   * Recompress dipakai untuk bikin hasil lebih "mushy".
   * Tapi jangan terlalu banyak, biar tidak muncul artifact kotak yang berlebihan.
   */
  const recompressQuality = clamp(finalQuality - 7, 7, 90);

  return {
    scale,
    softBlur,
    saturation,
    brightness,
    finalQuality,
    recompressQuality,
  };
}

export async function generate(
  opts: LqQuery,
  { signal }: LqGenerateOptions = {},
): Promise<LqResult> {
  await assertPublicUrl(opts.image);

  const key = cacheKey(opts);

  const cached = cache.get(key);
  if (cached) return cached;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = renderOnce(opts, signal)
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

async function renderOnce(
  opts: LqQuery,
  signal?: AbortSignal,
): Promise<LqResult> {
  const res = await fetch(opts.image, { signal });

  if (!res.ok) {
    throw Internal(`Failed to fetch image: ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const inputBuffer = Buffer.from(arrayBuffer);

  const meta = await sharp(inputBuffer).metadata();

  if (!meta.width || !meta.height) {
    throw Internal('Invalid image metadata');
  }

  const {
    scale,
    softBlur,
    saturation,
    brightness,
    finalQuality,
    recompressQuality,
  } = getLqParams(opts.level, opts.quality);

  const originalWidth = meta.width;
  const originalHeight = meta.height;

  const smallWidth = Math.max(10, Math.round(originalWidth * scale));
  const smallHeight = Math.max(10, Math.round(originalHeight * scale));

  /**
   * Tahap 1:
   * Kecilkan gambar drastis.
   *
   * Kernel lanczos3 dipakai saat downscale supaya bentuk utama masih kebaca.
   */
  let smallBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(smallWidth, smallHeight, {
      fit: 'fill',
      kernel: sharp.kernel.lanczos3,
    })
    .modulate({
      saturation,
      brightness,
    })
    .jpeg({
      quality: finalQuality,
      chromaSubsampling: '4:2:0',
      mozjpeg: true,
    })
    .toBuffer();

  /**
   * Tahap 2:
   * Smoothing ringan pada versi kecil.
   *
   * Ini penting supaya saat dibesarkan lagi,
   * hasilnya tidak jadi pixelated/kotak-kotak.
   */
  smallBuffer = await sharp(smallBuffer)
    .blur(softBlur)
    .jpeg({
      quality: recompressQuality,
      chromaSubsampling: '4:2:0',
      mozjpeg: true,
    })
    .toBuffer();

  /**
   * Tahap 3:
   * Besarkan lagi ke ukuran asli.
   *
   * Kernel cubic bikin hasil lebih smooth/mushy dibanding nearest.
   * Jangan pakai nearest, karena itu akan bikin pixelated.
   */
  let buffer = await sharp(smallBuffer)
    .resize(originalWidth, originalHeight, {
      fit: 'fill',
      kernel: sharp.kernel.cubic,
    })
    .jpeg({
      quality: recompressQuality,
      chromaSubsampling: '4:2:0',
      mozjpeg: true,
    })
    .toBuffer();

  /**
   * Tahap 4:
   * Final output sesuai format yang diminta.
   */
  if (opts.format === 'png') {
    buffer = await sharp(buffer).png().toBuffer();
  } else if (opts.format === 'webp') {
    buffer = await sharp(buffer)
      .webp({
        quality: finalQuality,
        effort: 3,
      })
      .toBuffer();
  } else {
    buffer = await sharp(buffer)
      .jpeg({
        quality: finalQuality,
        chromaSubsampling: '4:2:0',
        mozjpeg: true,
      })
      .toBuffer();
  }

  return {
    buffer,
    mimeType: MIME[opts.format],
    format: opts.format,
  };
}

export const lqService = {
  generate,
  cache,
};