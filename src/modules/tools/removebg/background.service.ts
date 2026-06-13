import sharp from 'sharp';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';

export interface BackgroundProcessInput {
  buffer?: Buffer;
  imageUrl?: string;
  filename?: string;
  mimetype?: string;
  format: 'png' | 'webp';
  background: 'transparent' | string;
  signal?: AbortSignal;
}

export interface BackgroundProcessResult {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/webp';
  format: 'png' | 'webp';
  provider: 'poof' | 'removebg';
}

type Provider = 'poof' | 'removebg';

type NormalizedBackground =
  | { type: 'transparent' }
  | { type: 'color'; hex: string };

const POOF_API_URL = 'https://api.poof.bg/v1/remove';
const REMOVEBG_API_URL = 'https://api.remove.bg/v1.0/removebg';

let poofCursor = 0;

function getEnvValue(name: string): string | undefined {
  try {
    const env = loadEnv() as ReturnType<typeof loadEnv> & Record<string, string | undefined>;
    return env[name] || process.env[name];
  } catch {
    return process.env[name];
  }
}

function getPoofKeys(): string[] {
  const raw = getEnvValue('POOF_API_KEYS') || getEnvValue('POOF_API_KEY') || '';

  return raw
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean);
}

function getNextPoofKey(): string | null {
  const keys = getPoofKeys();
  if (keys.length === 0) return null;

  const key = keys[poofCursor % keys.length];
  poofCursor = (poofCursor + 1) % keys.length;

  return key || null;
}

function normalizeBackground(background: string): string {
  const raw = background.trim();

  if (!raw) {
    throw new AppError(
      400,
      'BACKGROUND_INVALID_COLOR',
      'background is required',
    );
  }

  return raw;
}

function contentTypeFromFormat(format: 'png' | 'webp'): 'image/png' | 'image/webp' {
  return format === 'webp' ? 'image/webp' : 'image/png';
}

function shouldFallback(status: number): boolean {
  return (
    status === 401 ||
    status === 402 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 429 ||
    status >= 500
  );
}

function createImageBlob(input: BackgroundProcessInput): Blob {
  if (!input.buffer) {
    throw new AppError(400, 'BACKGROUND_NO_IMAGE', 'Please upload an image or provide image_url');
  }

  return new Blob([input.buffer], {
    type: input.mimetype || 'image/png',
  });
}

async function parseProviderError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => '');

  if (!raw) return `Provider returned ${res.status}`;

  try {
    const json = JSON.parse(raw) as any;

    const picked =
      json?.errors?.[0]?.title ||
      json?.errors?.[0]?.detail ||
      json?.error ||
      json?.message ||
      json?.detail;

    if (typeof picked === 'string') return picked;

    if (picked && typeof picked === 'object') {
      return JSON.stringify(picked).slice(0, 500);
    }

    return JSON.stringify(json).slice(0, 500);
  } catch {
    return raw.slice(0, 500);
  }
}

async function finalizeImage(
  buffer: Buffer,
  format: 'png' | 'webp',
): Promise<{ buffer: Buffer; mimeType: 'image/png' | 'image/webp' }> {
  if (format === 'webp') {
    const webp = await sharp(buffer).webp({ quality: 92, effort: 3 }).toBuffer();
    return { buffer: webp, mimeType: 'image/webp' };
  }

  return { buffer, mimeType: 'image/png' };
}

async function callPoof(input: BackgroundProcessInput, apiKey: string): Promise<BackgroundProcessResult> {
  if (!input.buffer) {
    throw new AppError(400, 'POOF_FILE_REQUIRED', 'Poof.bg provider requires file upload');
  }

  const form = new FormData();
  
  form.set('size', 'medium');
  
  if (input.background !== 'transparent') {
    form.set('format', input.format === 'webp' ? 'png' : input.format);
  }
  
  const background = normalizeBackground(input.background);
  
  if (background !== 'transparent') {
    form.set('bg_color', background.replace(/^#/, ''));
  }
  
  form.set('image_file', createImageBlob(input), input.filename || 'image.png');

  const res = await fetch(POOF_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
    },
    body: form,
    signal: input.signal,
  });

  if (!res.ok) {
    const message = await parseProviderError(res);

    throw new AppError(
      shouldFallback(res.status) ? 502 : res.status,
      `POOF_${res.status}`,
      message,
      {
        provider: 'poof' satisfies Provider,
        status: res.status,
        fallback: shouldFallback(res.status),
      },
    );
  }

  const rawBuffer = Buffer.from(await res.arrayBuffer());

  if (rawBuffer.length === 0) {
    throw new AppError(502, 'POOF_EMPTY', 'Poof.bg returned an empty image');
  }

  const final = await finalizeImage(rawBuffer, input.format);

  return {
    buffer: final.buffer,
    mimeType: final.mimeType,
    format: input.format,
    provider: 'poof',
  };
}

async function callRemoveBg(
  input: BackgroundProcessInput,
  apiKey: string,
): Promise<BackgroundProcessResult> {
  const background = normalizeBackground(input.background);

  const form = new FormData();
  form.set('size', 'auto');
  form.set('format', input.format);

  if (background !== 'transparent') {
    form.set('bg_color', background.replace(/^#/, ''));
  }

  if (input.imageUrl) {
    form.set('image_url', input.imageUrl);
  } else if (input.buffer) {
    form.set('image_file', createImageBlob(input), input.filename || 'image.png');
  } else {
    throw new AppError(400, 'BACKGROUND_NO_IMAGE', 'Please upload an image or provide image_url');
  }

  const res = await fetch(REMOVEBG_API_URL, {
    method: 'POST',
    headers: {
      'X-Api-Key': apiKey,
    },
    body: form,
    signal: input.signal,
  });

  if (!res.ok) {
    const message = await parseProviderError(res);

    if (res.status === 402) {
      throw new AppError(402, 'REMOVEBG_QUOTA_EXCEEDED', message);
    }

    if (res.status === 400) {
      throw new AppError(400, 'REMOVEBG_BAD_REQUEST', message);
    }

    if (res.status === 401 || res.status === 403) {
      throw new AppError(502, 'REMOVEBG_AUTH_FAILED', message);
    }

    throw new AppError(502, 'REMOVEBG_FAILED', message);
  }

  const rawBuffer = Buffer.from(await res.arrayBuffer());

  if (rawBuffer.length === 0) {
    throw new AppError(502, 'REMOVEBG_EMPTY', 'Remove.bg returned an empty image');
  }

  const final = await finalizeImage(rawBuffer, input.format);

  return {
    buffer: final.buffer,
    mimeType: final.mimeType,
    format: input.format,
    provider: 'removebg',
  };
}

export async function processBackground(
  input: BackgroundProcessInput,
): Promise<BackgroundProcessResult> {
  if (!input.buffer && !input.imageUrl) {
    throw new AppError(400, 'BACKGROUND_NO_IMAGE', 'Please upload an image or provide image_url');
  }

  normalizeBackground(input.background);

  const poofKey = getNextPoofKey();
  const removeBgKey = getEnvValue('REMOVEBG_API_KEY');

  if (!poofKey && !removeBgKey) {
    throw new AppError(
      500,
      'BACKGROUND_NOT_CONFIGURED',
      'No background provider API key is configured',
    );
  }

  let poofError: AppError | null = null;

  // Poof.bg hanya dipakai untuk upload file.
  // Kalau request pakai image_url, langsung fallback ke remove.bg.
  if (poofKey && input.buffer) {
    try {
      return await callPoof(input, poofKey);
    } catch (err) {
      if (err instanceof AppError) {
        poofError = err;
        const details = err.details as { fallback?: boolean } | undefined;

        if (!details?.fallback) throw err;
      } else {
        poofError = new AppError(
          502,
          'POOF_FAILED',
          err instanceof Error ? err.message : 'Poof.bg failed',
        );
      }
    }
  }

  if (removeBgKey) {
    return callRemoveBg(input, removeBgKey);
  }

  throw poofError || new AppError(502, 'BACKGROUND_FAILED', 'Background processing failed');
}

export const backgroundService = {
  processBackground,
};
