import { z } from 'zod';

export const TebakkabupatenResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    title: z.string(),
    url: z.string(),
  }),
});

export type TebakkabupatenResponse = z.infer<typeof TebakkabupatenResponse>;
