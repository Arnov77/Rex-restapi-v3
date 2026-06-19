import { z } from 'zod';

export const SusunkataResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    soal: z.string(),
    tipe: z.string(),
    jawaban: z.string(),
  }),
});

export type SusunkataResponse = z.infer<typeof SusunkataResponse>;
