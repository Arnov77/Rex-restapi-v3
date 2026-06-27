import * as tf from '@tensorflow/tfjs-node';
import * as nsfwjs from 'nsfwjs';
import * as jpeg from 'jpeg-js';
import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { AppError } from '@shared/errors.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';

const execFileAsync = promisify(execFile);

export interface NsfwResult {
  is_nsfw: boolean;
  score: number;
  rating: 'safe' | 'suggestive' | 'explicit';
  categories: string[];
  frames_checked: number;
}

// ─── Singleton Model ──────────────────────────────────────────────────────────

let modelPromise: Promise<nsfwjs.NSFWJS> | null = null;

export function loadNsfwModel(): Promise<nsfwjs.NSFWJS> {
  if (!modelPromise) {
    console.log('[nsfw] loading model...');
    modelPromise = nsfwjs.load().then((model: nsfwjs.NSFWJS) => {
      console.log('[nsfw] model loaded');
      return model;
    });
  }
  return modelPromise!;
}

// ─── Mime Detection ───────────────────────────────────────────────────────────

const VIDEO_MIMES = new Set([
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
  'video/x-msvideo', 'video/x-matroska', 'video/3gpp',
]);

const ANIMATED_MIMES = new Set(['image/gif', 'image/webp']);

function detectMime(buffer: Buffer, mimeHint?: string): string {
  // Magic bytes detection
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[4] === 0x57) return 'image/webp';
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return 'video/mp4';
  if (buffer[0] === 0x1A && buffer[1] === 0x45) return 'video/webm';
  return mimeHint ?? 'image/jpeg';
}

// ─── Single Frame Classify ────────────────────────────────────────────────────

async function classifyJpegBuffer(jpegBuf: Buffer): Promise<Record<string, number>> {
  const model = await loadNsfwModel();

  // Resize ke 224x224 dulu — ukuran yang nsfwjs butuhkan, hemat memory signifikan
  const resized = await sharp(jpegBuf)
    .resize(224, 224, { fit: 'cover' })
    .jpeg({ quality: 85 })
    .toBuffer();

  const decoded = jpeg.decode(resized, { useTArray: true });
  const { width, height, data } = decoded;

  // RGBA → RGB
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j]     = data[i]!;
    rgb[j + 1] = data[i + 1]!;
    rgb[j + 2] = data[i + 2]!;
  }

  const image = tf.tensor3d(rgb, [height, width, 3]);
  try {
    const predictions = await model.classify(image as any);
    const scores: Record<string, number> = {};
    for (const p of predictions) scores[p.className] = p.probability;
    return scores;
  } finally {
    image.dispose();
  }
}

// ─── Result Builder ───────────────────────────────────────────────────────────

function buildResult(allScores: Record<string, number>[], framesChecked: number): NsfwResult {
  // Worst-case frame menentukan hasil akhir
  let maxPorn = 0, maxHentai = 0, maxSexy = 0;
  for (const s of allScores) {
    maxPorn   = Math.max(maxPorn,   s['Porn']   ?? 0);
    maxHentai = Math.max(maxHentai, s['Hentai'] ?? 0);
    maxSexy   = Math.max(maxSexy,   s['Sexy']   ?? 0);
  }

  const pornScore  = maxPorn + maxHentai;
  const totalScore = pornScore + maxSexy * 0.5;

  const categories: string[] = [];
  if (maxPorn   > 0.3) categories.push('nudity/sexual');
  if (maxHentai > 0.3) categories.push('hentai');
  if (maxSexy   > 0.4) categories.push('suggestive');

  let rating: 'safe' | 'suggestive' | 'explicit';
  let is_nsfw: boolean;

  if (pornScore > 0.5) {
    rating = 'explicit'; is_nsfw = true;
  } else if (totalScore > 0.3) {
    rating = 'suggestive'; is_nsfw = true;
  } else {
    rating = 'safe'; is_nsfw = false;
  }

  return { is_nsfw, score: Math.min(1, totalScore), rating, categories, frames_checked: framesChecked };
}

// ─── Animated GIF/WebP ────────────────────────────────────────────────────────

const MAX_ANIMATED_FRAMES = 4;

async function classifyAnimated(buffer: Buffer): Promise<NsfwResult> {
  const sharpImg = sharp(buffer, { animated: true });
  const meta = await sharpImg.metadata();
  const totalFrames = meta.pages ?? 1;

  // Ambil frame secara merata, max 8 frame
  const step = Math.max(1, Math.floor(totalFrames / MAX_ANIMATED_FRAMES));
  const frameIndices: number[] = [];
  for (let i = 0; i < totalFrames && frameIndices.length < MAX_ANIMATED_FRAMES; i += step) {
    frameIndices.push(i);
  }

  const allScores: Record<string, number>[] = [];
  for (const idx of frameIndices) {
    const frameBuf = await sharp(buffer, { animated: false, page: idx })
      .jpeg({ quality: 85 })
      .toBuffer();
    const scores = await classifyJpegBuffer(frameBuf);
    allScores.push(scores);

    // Early exit kalau sudah ketemu explicit
    if ((scores['Porn'] ?? 0) + (scores['Hentai'] ?? 0) > 0.7) break;
  }

  return buildResult(allScores, allScores.length);
}

// ─── Video (ffmpeg) ───────────────────────────────────────────────────────────

const VIDEO_SCAN_SECONDS = 8;  // scan N detik pertama
const VIDEO_FPS_EXTRACT  = 0.5; // 1 frame tiap 2 detik
const MAX_VIDEO_FRAMES   = 4;

async function classifyVideo(buffer: Buffer): Promise<NsfwResult> {
  const tmpDir = await mkdtemp(join(tmpdir(), 'nsfw-'));

  try {
    const inputPath  = join(tmpDir, 'input.mp4');
    const outputGlob = join(tmpDir, 'frame-%03d.jpg');

    await (await import('node:fs/promises')).writeFile(inputPath, buffer);

    // Extract frames dari N detik pertama
    await execFileAsync('ffmpeg', [
      '-i', inputPath,
      '-t', String(VIDEO_SCAN_SECONDS),
      '-vf', `fps=${VIDEO_FPS_EXTRACT}`,
      '-vframes', String(MAX_VIDEO_FRAMES),
      '-q:v', '3',
      outputGlob,
    ]);

    const files = (await readdir(tmpDir))
      .filter((f) => f.startsWith('frame-') && f.endsWith('.jpg'))
      .sort();

    if (files.length === 0) {
      throw new AppError(400, 'NSFW_VIDEO_NO_FRAMES', 'Tidak ada frame yang bisa diekstrak dari video', null, 'Video tidak bisa diproses. Pastikan format video valid.');
    }

    const allScores: Record<string, number>[] = [];
    for (const file of files) {
      const frameBuf = await readFile(join(tmpDir, file));
      const scores   = await classifyJpegBuffer(frameBuf);
      allScores.push(scores);

      // Early exit
      if ((scores['Porn'] ?? 0) + (scores['Hentai'] ?? 0) > 0.7) break;
    }

    return buildResult(allScores, allScores.length);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ─── Static Image ─────────────────────────────────────────────────────────────

async function classifyStaticImage(buffer: Buffer): Promise<NsfwResult> {
  // Konversi ke JPEG dulu via sharp (support PNG, WebP static, HEIC, dll)
  const jpegBuf = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  const scores  = await classifyJpegBuffer(jpegBuf);
  return buildResult([scores], 1);
}

// ─── Main Classifier ──────────────────────────────────────────────────────────

async function classifyBuffer(buffer: Buffer, mimeHint?: string): Promise<NsfwResult> {
  const mime = detectMime(buffer, mimeHint);

  if (VIDEO_MIMES.has(mime)) return classifyVideo(buffer);
  if (ANIMATED_MIMES.has(mime)) return classifyAnimated(buffer);
  return classifyStaticImage(buffer);
}

// ─── Public API ───────────────────────────────────────────────────────────────

const MAX_SIZE = 50 * 1024 * 1024; // 50 MB untuk video

export async function detectNsfwFromUrl(imageUrl: string): Promise<NsfwResult> {
  await assertPublicUrl(imageUrl);

  const res = await fetch(imageUrl);
  if (!res.ok) throw new AppError(400, 'NSFW_FETCH_FAILED', `Gagal fetch: ${res.status}`, null, 'URL tidak bisa diakses.');

  const buffer   = Buffer.from(await res.arrayBuffer());
  const mimeHint = (res.headers.get('content-type') ?? '').split(';')[0]!.trim();
  return classifyBuffer(buffer, mimeHint);
}

export async function detectNsfwFromBuffer(buffer: Buffer, mimeType?: string): Promise<NsfwResult> {
  if (!buffer.length) throw new AppError(400, 'NSFW_EMPTY_FILE', 'File kosong', null, 'File yang diupload kosong.');
  if (buffer.length > MAX_SIZE) throw new AppError(413, 'NSFW_FILE_TOO_LARGE', `File > ${MAX_SIZE / 1024 / 1024}MB`, null, `Ukuran file terlalu besar, maksimal ${MAX_SIZE / 1024 / 1024} MB.`);
  return classifyBuffer(buffer, mimeType);
}