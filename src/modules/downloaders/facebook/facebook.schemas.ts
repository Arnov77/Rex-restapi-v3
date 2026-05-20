import { z } from 'zod';

export const FacebookQuery = z.object({
  url: z.string().url().refine(
    (u) => /facebook\.com|fb\.watch|fb\.com|fbcdn\.net/i.test(u),
    { message: 'Must be a valid Facebook URL' },
  ),
});
export type FacebookQuery = z.infer<typeof FacebookQuery>;

const MediaItem = z.object({
  type: z.enum(['video', 'image']),
  url: z.string(),
  quality: z.string().optional(),
});

export const FacebookResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    author: z.object({
      name: z.string(),
      username: z.string(),
    }),
    thumbnail: z.string().nullable(),
    duration: z.number().nullable(),
    media: z.array(MediaItem),
  }),
});
