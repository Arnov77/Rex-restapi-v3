import { z } from 'zod';

export const UpscalerQuery = z.object({
  image: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar publik — gunakan ini ATAU upload file'),
});

export type UpscalerQuery = z.infer<typeof UpscalerQuery>;
