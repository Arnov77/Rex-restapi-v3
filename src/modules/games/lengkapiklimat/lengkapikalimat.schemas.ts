import { z } from 'zod';

export const LengkapikalimatResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type LengkapikalimatResponse = z.infer<typeof LengkapikalimatResponse>;
