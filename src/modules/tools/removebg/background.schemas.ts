import { z } from 'zod';

export const RemoveBgQuery = z.object({
  format: z.enum(['png', 'webp']).default('png'),
  image_url: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar publik — gunakan ini ATAU upload file'),
});

export const ChangeBgQuery = z.object({
  background: z
  .string()
  .trim()
  .min(1)
  .default('white')
  .describe('Warna background, contoh: green, red, white, black, #ffffff'),
  format: z.enum(['png', 'webp']).default('png'),
  image_url: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar publik — gunakan ini ATAU upload file'),
});

export type RemoveBgQuery = z.infer<typeof RemoveBgQuery>;
export type ChangeBgQuery = z.infer<typeof ChangeBgQuery>;
