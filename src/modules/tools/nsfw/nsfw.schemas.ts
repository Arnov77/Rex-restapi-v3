import { z } from 'zod';

export const NsfwQuery = z.object({
  image: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar/GIF/video yang akan diperiksa. Gunakan ini ATAU upload file multipart.'),
});

export const NsfwResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    is_nsfw: z.boolean().describe('true jika konten mengandung NSFW'),
    score: z.number().min(0).max(1).describe('Skor probabilitas NSFW (0.0 = aman, 1.0 = eksplisit)'),
    rating: z
      .enum(['safe', 'suggestive', 'explicit'])
      .describe('safe = aman, suggestive = dewasa ringan, explicit = eksplisit'),
    categories: z
      .array(z.string())
      .describe('Kategori konten yang terdeteksi, kosong jika aman'),
    frames_checked: z
      .number()
      .int()
      .describe('Jumlah frame yang diperiksa (>1 untuk GIF/WebP animasi dan video)'),
  }),
});

export type NsfwQuery = z.infer<typeof NsfwQuery>;
export type NsfwResponse = z.infer<typeof NsfwResponse>;