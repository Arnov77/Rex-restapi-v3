import { z } from 'zod';

export const DeezloadQuery = z.object({
  query: z.string().min(1, 'Query is required'),
});

export type DeezloadQuery = z.infer<typeof DeezloadQuery>;

export const DeezloadResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string().nullable(),
    description: z.string().nullable(),
    filename: z.string(),
    format: z.literal('flac'),
    url: z.string(),
  }),
});