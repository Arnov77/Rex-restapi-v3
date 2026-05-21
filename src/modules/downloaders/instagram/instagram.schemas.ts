import { z } from 'zod';

export const InstagramQuery = z.object({
  url: z.string().url().refine(
    (u) => /instagram\.com|instagr\.am/i.test(u),
    { message: 'Must be a valid Instagram URL' },
  ),
});
export type InstagramQuery = z.infer<typeof InstagramQuery>;

const MediaItem = z.object({
  type: z.enum(['video', 'image']),
  url: z.string(),
  quality: z.string().optional(),
});

export const InstagramResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    author: z.object({
      name: z.string(),
      username: z.string(),
    }),
    thumbnail: z.string().nullable(),
    media: z.array(MediaItem),
  }),
});
