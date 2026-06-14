import { z } from 'zod';

export const MediafireQuery = z.object({
  url: z.string().url().refine(
    (u) => /mediafire\.com/i.test(u),
    { message: 'Must be a valid MediaFire URL' },
  ),
});
export type MediafireQuery = z.infer<typeof MediafireQuery>;

export const MediafireResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    filename: z.string(),
    size: z.string().nullable(),
    mimetype: z.string().nullable(),
    uploadedAt: z.string().nullable(),
    downloadUrl: z.string(),
  }),
});
