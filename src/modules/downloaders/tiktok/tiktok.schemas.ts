import { z } from 'zod';

export const TiktokQuery = z.object({
  url: z.string().url().refine(
    (u) => /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(u),
    { message: 'Must be a valid TikTok URL' },
  ),
});
export type TiktokQuery = z.infer<typeof TiktokQuery>;

const MediaItem = z.object({
  type: z.enum(['video', 'audio', 'image']),
  url: z.string(),
  quality: z.string().optional(),
});

export const TiktokResponse = z.object({
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
