import { Client } from '@gradio/client';
import { AppError } from '@shared/errors.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import { loadEnv } from '../../../config/env.js';
import { HITAM_STYLE, HITAM_PROMPT } from './hitam.schemas.js';

const HF_SPACE = 'prithivMLmods/Qwen-Image-Edit-2511-LoRAs-Fast';

export interface HitamResult {
  buffer: Buffer;
  mimeType: string;
}

// ─── Token Rotator ────────────────────────────────────────────────────────────

let tokens: string[] = [];
let tokenIndex = 0;

function loadTokens(): string[] {
  if (tokens.length > 0) return tokens;
  const env = loadEnv();
  const raw = env.HF_TOKENS ?? '';
  tokens = raw.split(',').map((t: string) => t.trim()).filter(Boolean);
  return tokens; 
}

function nextToken(): string | undefined {
  const t = loadTokens();
  if (t.length === 0) return undefined;
  const token = t[tokenIndex % t.length];
  tokenIndex = (tokenIndex + 1) % t.length;
  return token;
}

function isQuotaError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? '').toLowerCase();
  return msg.includes('zerogpu quota') || msg.includes('exceeded your') || msg.includes('quota');
}

// ─── Core Logic ───────────────────────────────────────────────────────────────

async function hitamFromBase64(imgsJson: string, seed?: number): Promise<HitamResult> {
  const actualSeed = seed ?? Math.floor(Math.random() * 2147483647);
  const allTokens = loadTokens();
  
  // Coba semua token + 1 attempt anonymous kalau tidak ada token
  const attempts = allTokens.length > 0 ? allTokens.length : 1;
  let lastError: unknown;

  for (let i = 0; i < attempts; i++) {
    const token = nextToken();
    let client: Client;
    
    try {
      client = await Client.connect(HF_SPACE, token ? { token: token as `hf_${string}` } : {});
    } catch (err) {
      lastError = err;
      continue;
    }

    let result: any;
    try {
      // Parameter order: [images_json, prompt, lora_name, seed, randomize_seed, guidance_scale, steps]
      result = await client.predict('/edit_image', [
        imgsJson,
        HITAM_PROMPT,
        HITAM_STYLE,
        actualSeed,
        seed === undefined,
        3.5,
        8,
      ]);
    } catch (err: any) {
      if (isQuotaError(err)) {
        lastError = err;
        continue;
      }
      const msg = String(err?.message ?? '').toLowerCase();
      if (msg.includes('queue') || msg.includes('timeout')) {
        throw new AppError(503, 'HITAM_QUEUE_TIMEOUT', 'HF Space queue timeout', null, 'The server is busy right now. Please try again shortly.');
      }
      throw new AppError(502, 'HITAM_INFERENCE_FAILED', `Image generation failed: ${err?.message ?? 'unknown error'}`, null, 'Could not process this image. Try a different one.');
    }

    const output = Array.isArray(result?.data) ? result.data[0] : result?.data;
    const outputUrl: string | undefined = typeof output === 'string' ? output : output?.url ?? output?.path ?? undefined;

    if (!outputUrl) throw new AppError(502, 'HITAM_NO_OUTPUT', 'HF Space returned no output', null, 'Could not process this image. Try again with a different one.');

    const dlRes = await fetch(outputUrl);
    if (!dlRes.ok) throw new AppError(502, 'HITAM_DOWNLOAD_FAILED', `Failed to download result: ${dlRes.status}`, null, 'Could not retrieve the result image. Please try again.');

    const buffer = Buffer.from(await dlRes.arrayBuffer());
    const mimeType = dlRes.headers.get('content-type') ?? 'image/jpeg';

    return { buffer, mimeType };
  }

  throw new AppError(
    503,
    'HITAM_QUOTA_EXHAUSTED',
    `All HuggingFace tokens hit ZeroGPU quota (${attempts} tokens tried)`, // → internal log
    null,
    'The hitam feature is busy right now. Please try again in a few minutes.' // → response to user
  );
}

// ─── Wrappers ─────────────────────────────────────────────────────────────────

/**
 * Handler jika input berupa URL gambar
 */
export async function hitamFromUrl(imageUrl: string, seed?: number): Promise<HitamResult> {
  await assertPublicUrl(imageUrl);
  
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new AppError(400, 'HITAM_FETCH_FAILED', `Failed to fetch image: ${imgRes.status}`, null, 'Could not access that image URL. Make sure it is valid and publicly accessible.');
  
  const imgBuf = Buffer.from(await imgRes.arrayBuffer());
  const imgsJson = JSON.stringify([imgBuf.toString('base64')]);
  
  return hitamFromBase64(imgsJson, seed);
}

/**
 * Handler jika input berupa Buffer (dari multipart form data / upload langsung)
 */
export async function hitamFromBuffer(buffer: Buffer, seed?: number): Promise<HitamResult> {
  const imgsJson = JSON.stringify([buffer.toString('base64')]);
  return hitamFromBase64(imgsJson, seed);
}