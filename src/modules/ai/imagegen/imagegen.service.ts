import { AppError } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';
import { withGroq } from '@shared/groqRotator.js';

async function generateNegativePrompt(prompt: string): Promise<string> {
  return withGroq(async (groq) => {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 100,
      messages: [
        {
          role: 'system',
          content: 'You are an expert at Stable Diffusion prompting. Given a user\'s image generation prompt, respond with ONLY a concise negative prompt (comma-separated keywords) that would improve the output quality. No explanation, no preamble, just the keywords.',
        },
        {
          role: 'user',
          content: `Image prompt: "${prompt}"\n\nGenerate negative prompt:`,
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() ?? '';
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

  // Auto-generate negative prompt kalau tidak diisi user
  const finalNegative = negativePrompt ?? await generateNegativePrompt(prompt).catch(() => '');

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
        prompt,
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
