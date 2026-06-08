import { z } from 'zod';

export const ImagegenQuery = z.object({
  prompt: z
    .string()
    .min(1)
    .max(1000)
    .describe('Deskripsi gambar yang ingin digenerate'),

  negative_mode: z
    .enum(['auto', 'custom', 'none'])
    .default('auto')
    .describe(
      'Mode negative prompt. auto = dibuat otomatis, custom = pakai negative_prompt dari user, none = tanpa negative prompt',
    ),

  negative_prompt: z
    .string()
    .max(500)
    .optional()
    .describe('Negative prompt custom. Digunakan hanya kalau negative_mode=custom'),
});

export type ImagegenQuery = z.infer<typeof ImagegenQuery>;