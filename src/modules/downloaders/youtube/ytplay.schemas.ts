import { z } from 'zod';

export const YtPlayQuery = z.object({
  query: z
    .string()
    .trim()
    .min(1, 'query is required')
    .max(300, 'query is too long')
    .describe('Judul lagu/video atau link YouTube langsung'),
});

export type YtPlayQuery = z.infer<typeof YtPlayQuery>;
