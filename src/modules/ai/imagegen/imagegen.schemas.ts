import { z } from 'zod';

export const ImagegenQuery = z.object({
  prompt: z.string().min(1).max(1000).describe('Deskripsi gambar yang ingin digenerate'),
  negative_prompt: z.string().max(500).optional().describe('Hal yang tidak ingin muncul di gambar (opsional)'),
});

export type ImagegenQuery = z.infer<typeof ImagegenQuery>;
