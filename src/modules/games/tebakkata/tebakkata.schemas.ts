import { z } from 'zod';

export const TebakkataResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type TebakkataResponse = z.infer<typeof TebakkataResponse>;
