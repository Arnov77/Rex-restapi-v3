import { AppError } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';
import { withGroq } from '@shared/groqRotator.js';

interface PromptResult {
  translatedPrompt: string;
  negativePrompt: string;
}

async function processPrompt(prompt: string, negativePrompt?: string): Promise<PromptResult> {
  return withGroq(async (groq) => {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 200,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are an expert Stable Diffusion prompt engineer. Given a user's image prompt (in any language), respond ONLY with a JSON object with these fields:
- "prompt": the prompt translated to English and optimized for image generation (keep it concise, add style keywords if helpful)
- "negative_prompt": concise negative prompt keywords relevant to the image type (comma-separated)

Example response: {"prompt": "anime girl with blonde hair eating street food, detailed, high quality", "negative_prompt": "bad anatomy, extra fingers, deformed, blurry, low quality"}`,
        },
        {
          role: 'user',
          content: `User prompt: "${prompt}"`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { /* fallback */ }

    return {
      translatedPrompt: parsed.prompt || prompt,
      negativePrompt: negativePrompt ?? parsed.negative_prompt ?? '',
    };
  });
}

export async function generateImage(prompt: string, negativePrompt?: string): Promise<Buffer> {
  const env = loadEnv();

  if (!env.CF_WORKER_URL) {
    throw new AppError(503, 'CF_WORKER_NOT_CONFIGURED', 'CF_WORKER_URL belum di-set di environment');
  }
  if (!env.CF_WORKER_API_KEY) {
    throw new AppError(503, 'CF_WORKER_NOT_CONFIGURED', 'CF_WORKER_API_KEY belum di-set di environment');
  }

  // Translate + auto negative prompt via Groq
  const { translatedPrompt, negativePrompt: finalNegative } = await processPrompt(prompt, negativePrompt).catch(() => ({
    translatedPrompt: prompt,
    negativePrompt: negativePrompt ?? '',
  }));

  console.log('[imagegen] translated prompt:', translatedPrompt);
  console.log('[imagegen] negative prompt:', finalNegative);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(env.CF_WORKER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_WORKER_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: translatedPrompt,
        ...(finalNegative ? { negative_prompt: finalNegative } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new AppError(502, 'CF_WORKER_ERROR', `Cloudflare Worker error ${res.status}: ${text}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length === 0) throw new AppError(502, 'CF_WORKER_EMPTY', 'Worker tidak mengembalikan gambar');

    return buffer;
  } finally {
    clearTimeout(timeout);
  }
}
