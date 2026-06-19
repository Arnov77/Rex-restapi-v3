import { z } from 'zod';

export const TebaktebakanResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type TebaktebakanResponse = z.infer<typeof TebaktebakanResponse>;
