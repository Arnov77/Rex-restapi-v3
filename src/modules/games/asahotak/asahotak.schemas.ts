import { z } from 'zod';

export const AsahotakResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type AsahotakResponse = z.infer<typeof AsahotakResponse>;
