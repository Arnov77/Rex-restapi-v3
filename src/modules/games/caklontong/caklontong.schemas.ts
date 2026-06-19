import { z } from 'zod';

export const CaklontongResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    soal: z.string(),
    jawaban: z.string(),
    deskripsi: z.string(),
  }),
});

export type CaklontongResponse = z.infer<typeof CaklontongResponse>;
