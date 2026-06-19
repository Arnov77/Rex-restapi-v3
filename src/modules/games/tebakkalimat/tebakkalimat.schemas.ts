import { z } from 'zod';

export const TebakkalimatResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type TebakkalimatResponse = z.infer<typeof TebakkalimatResponse>;
