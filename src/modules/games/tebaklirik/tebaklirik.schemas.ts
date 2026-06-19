import { z } from 'zod';

export const TebaklirikResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type TebaklirikResponse = z.infer<typeof TebaklirikResponse>;
