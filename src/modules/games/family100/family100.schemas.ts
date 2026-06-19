import { z } from 'zod';

export const Family100Response = z.object({
  ok: z.literal(true),
  data: z.object({
    soal: z.string(),
    jawaban: z.array(z.string()),
  }),
});

export type Family100Response = z.infer<typeof Family100Response>;
