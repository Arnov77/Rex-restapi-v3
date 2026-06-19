import { z } from 'zod';

export const Tebakbendera2Response = z.object({
  ok: z.literal(true),
  data: z.object({
    img: z.string(),
    name: z.string(),
  }),
});

export type Tebakbendera2Response = z.infer<typeof Tebakbendera2Response>;
