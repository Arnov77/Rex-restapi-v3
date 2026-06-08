import { AppError } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';

export type NegativeMode = 'auto' | 'custom' | 'none';

export interface GenerateImageOptions {
  prompt: string;
  negativeMode?: NegativeMode;
  negativePrompt?: string;
}

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export async function generateImage(options: GenerateImageOptions): Promise<Buffer> {
  const env = loadEnv();

  if (!env.CF_WORKER_URL) {
    throw new AppError(503, 'CF_WORKER_NOT_CONFIGURED', 'CF_WORKER_URL belum di-set di environment');
  }

  if (!env.CF_WORKER_API_KEY) {
    throw new AppError(503, 'CF_WORKER_NOT_CONFIGURED', 'CF_WORKER_API_KEY belum di-set di environment');
  }

  const prompt = options.prompt.trim();
  const negativeMode = options.negativeMode ?? 'auto';

  if (!prompt) {
    throw new AppError(400, 'PROMPT_REQUIRED', 'Prompt wajib diisi');
  }

  let finalNegativePrompt = '';

  if (negativeMode === 'auto') {
    finalNegativePrompt = await generateNegativePromptWithGroq(prompt);
  } else if (negativeMode === 'custom') {
    finalNegativePrompt = sanitizeNegativePrompt(options.negativePrompt);

    if (!finalNegativePrompt) {
      throw new AppError(
        400,
        'NEGATIVE_PROMPT_REQUIRED',
        'negative_prompt wajib diisi kalau negative_mode=custom',
      );
    }
  } else if (negativeMode === 'none') {
    finalNegativePrompt = '';
  } else {
    throw new AppError(
      400,
      'INVALID_NEGATIVE_MODE',
      'negative_mode harus auto, custom, atau none',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(env.CF_WORKER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_WORKER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt,
        ...(finalNegativePrompt ? { negative_prompt: finalNegativePrompt } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(502, 'CF_WORKER_ERROR', `Cloudflare Worker error ${res.status}: ${text}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());

    if (buffer.length === 0) {
      throw new AppError(502, 'CF_WORKER_EMPTY', 'Worker tidak mengembalikan gambar');
    }

    return buffer;
  } catch (err) {
    if (err instanceof AppError) throw err;

    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError(504, 'CF_WORKER_TIMEOUT', 'Cloudflare Worker timeout saat generate gambar');
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

async function generateNegativePromptWithGroq(prompt: string): Promise<string> {
  const env = loadEnv();

  if (!env.GROQ_API_KEY) {
    throw new AppError(503, 'GROQ_NOT_CONFIGURED', 'GROQ_API_KEY belum di-set di environment');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.GROQ_MODEL || 'llama-3.1-8b-instant',
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          {
            role: 'system',
            content:
              [
                'You generate negative prompts for AI image generation.',
                'Output only comma-separated negative terms.',
                'No explanation.',
                'No numbering.',
                'No markdown.',
                'Max 25 terms.',
                'Keep it general, clean, and useful.',
              ].join(' '),
          },
          {
            role: 'user',
            content: `Create a negative prompt for this image prompt:\n\n${prompt}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(502, 'GROQ_ERROR', `Groq error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as GroqChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content || '';

    const negativePrompt = sanitizeNegativePrompt(content);

    return negativePrompt || getFallbackNegativePrompt(prompt);
  } catch (err) {
    if (err instanceof AppError) throw err;

    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError(504, 'GROQ_TIMEOUT', 'Groq timeout saat generate negative prompt');
    }

    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeNegativePrompt(value?: string): string {
  if (!value || typeof value !== 'string') return '';

  return value
    .replace(/\n/g, ', ')
    .replace(/[^\w\s,.'"-]/g, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 25)
    .join(', ')
    .slice(0, 500);
}

function getFallbackNegativePrompt(prompt: string): string {
  const lowerPrompt = prompt.toLowerCase();

  const base = [
    'low quality',
    'blurry',
    'distorted',
    'deformed',
    'bad composition',
    'jpeg artifacts',
    'watermark',
    'text',
    'logo',
    'oversaturated',
    'underexposed',
  ];

  if (
    lowerPrompt.includes('person') ||
    lowerPrompt.includes('portrait') ||
    lowerPrompt.includes('girl') ||
    lowerPrompt.includes('boy') ||
    lowerPrompt.includes('man') ||
    lowerPrompt.includes('woman') ||
    lowerPrompt.includes('anime') ||
    lowerPrompt.includes('character')
  ) {
    base.push(
      'bad anatomy',
      'bad hands',
      'extra fingers',
      'missing fingers',
      'extra limbs',
      'duplicate body parts',
      'bad face',
      'bad eyes',
      'bad proportions',
    );
  }

  if (
    lowerPrompt.includes('logo') ||
    lowerPrompt.includes('icon') ||
    lowerPrompt.includes('badge')
  ) {
    base.push(
      'messy layout',
      'complex background',
      'tiny unreadable text',
      'photorealistic',
      'noise',
    );
  }

  return base.slice(0, 25).join(', ');
}