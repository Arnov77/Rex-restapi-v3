import { z } from 'zod';

export const YoutubeQuery = z.object({
  url: z.string().url().refine(
    (u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u),
    { message: 'Must be a valid YouTube URL' },
  ),
});
export type YoutubeQuery = z.infer<typeof YoutubeQuery>;

const MediaItem = z.object({
  type: z.enum(['video', 'audio']),
  url: z.string(),
  quality: z.string().optional(),
});

export const YoutubeResponse = z.object({
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
