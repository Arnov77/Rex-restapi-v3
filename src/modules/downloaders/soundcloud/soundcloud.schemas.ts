import { z } from 'zod';

export const SoundcloudQuery = z.object({
  url: z.string().url().refine(
    (u) => /soundcloud\.com|snd\.sc/i.test(u),
    { message: 'Must be a valid SoundCloud URL' },
  ),
});
export type SoundcloudQuery = z.infer<typeof SoundcloudQuery>;

export const SoundcloudResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    author: z.object({
      name: z.string(),
      username: z.string(),
    }),
    thumbnail: z.string().nullable(),
    duration: z.number().nullable(),
    url: z.string(),
    format: z.literal('mp3'),
  }),
});