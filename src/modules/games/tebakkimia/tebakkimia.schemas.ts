import { z } from 'zod';

export const TebakkimiaResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    unsur: z.string(),
    lambang: z.string(),
  }),
});

export type TebakkimiaResponse = z.infer<typeof TebakkimiaResponse>;
