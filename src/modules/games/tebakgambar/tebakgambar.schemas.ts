import { z } from 'zod';

export const TebakgambarResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.number(),
    img: z.string(),
    jawaban: z.string(),
    deskripsi: z.string(),
  }),
});

export type TebakgambarResponse = z.infer<typeof TebakgambarResponse>;
