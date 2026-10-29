import { z } from 'zod';

export const TebaklogoResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    index: z.string(),
    img: z.string(),
    jawaban: z.string(),
    deskripsi: z.string(),
  }),
});

export type TebaklogoResponse = z.infer<typeof TebaklogoResponse>;
