import { Client } from '@gradio/client';
import { AppError } from '@shared/errors.js';
import { assertPublicUrl } from '@shared/utils/ssrfGuard.js';
import { loadEnv } from '../../../config/env.js';

const HF_SPACE = 'Phips/Upscaler';
const DEFAULT_MODEL = '4xNomosWebPhoto_RealPLKSR';

export interface UpscalerResult {
  buffer: Buffer;
  mimeType: 'image/png';
}

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

async function upscaleBuffer(imageBuffer: Buffer): Promise<UpscalerResult> {
  const allTokens = loadTokens();
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

    try {
      const blob = new Blob([imageBuffer], { type: 'image/png' });

      const result: any = await client.predict('/upscale_image', [
        blob,
        DEFAULT_MODEL,
      ]);

      // Returns: [ImageSlider tuple, File object]
      // File object has .url property
      const fileObj = result?.data?.[1];
      const fileUrl: string | undefined = fileObj?.url;
      if (!fileUrl) throw new AppError(502, 'UPSCALER_NO_OUTPUT', 'HF Space returned no output');

      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) throw new AppError(502, 'UPSCALER_FETCH_FAILED', 'Failed to fetch upscaled image');

      const buffer = Buffer.from(await fileRes.arrayBuffer());
      return { buffer, mimeType: 'image/png' };
    } catch (err: any) {
      if (isQuotaError(err)) {
        lastError = err;
        continue;
      }
      throw new AppError(
        502,
        'UPSCALER_FAILED',
        `Upscaling failed: ${err?.message ?? 'unknown error'}`,
        null,
        'Could not upscale this image. Try again or use a different image.',
      );
    }
  }

  throw new AppError(
    503,
    'UPSCALER_QUOTA_EXHAUSTED',
    `All HuggingFace tokens hit ZeroGPU quota (${attempts} tokens tried)`,
    null,
    'The upscaler is busy right now. Please try again in a few minutes.',
  );
}

export async function upscaleFromUrl(imageUrl: string): Promise<UpscalerResult> {
  await assertPublicUrl(imageUrl);
  const res = await fetch(imageUrl);
  if (!res.ok) throw new AppError(400, 'UPSCALER_FETCH_FAILED', `Failed to fetch image: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  return upscaleBuffer(buffer);
}

export async function upscaleFromBuffer(buffer: Buffer): Promise<UpscalerResult> {
  return upscaleBuffer(buffer);
}
