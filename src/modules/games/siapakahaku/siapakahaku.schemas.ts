import { z } from 'zod';

export const SiapakahakuResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type SiapakahakuResponse = z.infer<typeof SiapakahakuResponse>;
