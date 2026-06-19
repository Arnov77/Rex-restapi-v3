import { z } from 'zod';

export const TekatekiResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    soal: z.string(),
    jawaban: z.string(),
  }),
});

export type TekatekiResponse = z.infer<typeof TekatekiResponse>;
