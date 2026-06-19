import { z } from 'zod';

export const TebakbenderaResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    flag: z.string(),
    img: z.string(),
    name: z.string(),
  }),
});

export type TebakbenderaResponse = z.infer<typeof TebakbenderaResponse>;
