import { z } from 'zod';

export const PinterestSearchQuery = z.object({
  q: z.string().min(1).max(200).describe('Kata kunci pencarian'),
});

export type PinterestSearchQuery = z.infer<typeof PinterestSearchQuery>;

export const PinterestSearchResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    query: z.string(),
    results: z.array(z.object({
      id: z.string(),
      title: z.string().nullable(),
      image: z.string().nullable(),
      thumbnail: z.string().nullable(),
      board: z.string().nullable(),
      username: z.string().nullable(),
      source: z.string().nullable(),
    })),
  }),
});
