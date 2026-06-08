import { z } from 'zod';

export const PinterestQuery = z.object({
  url: z.string().url().refine(
    (u) => /pinterest\.(com|co\.[a-z]{2}|[a-z]{2})|pin\.it/i.test(u),
    { message: 'Must be a valid Pinterest URL' },
  ),
});
export type PinterestQuery = z.infer<typeof PinterestQuery>;

const MediaItem = z.object({
  type: z.enum(['image', 'video']),
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  quality: z.string().optional(),
});

export const PinterestResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    author: z.object({
      name: z.string(),
      username: z.string(),
    }),
    board: z.string().nullable(),
    thumbnail: z.string().nullable(),
    media: z.array(MediaItem),
  }),
});
