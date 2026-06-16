import { z } from 'zod';

export const HITAM_STYLE = 'Style-Transfer' as const;
export const HITAM_PROMPT = "Edit the image by changing only the character's skin color to a dark skin tone. Preserve all other visual attributes exactly as they are, including hair color and texture, eye color and shape, clothing, accessories, background, lighting, shadows, and facial expression. Do not modify any non-skin areas. Apply the skin color change smoothly and naturally, ensuring the result looks realistic without bleeding into surrounding elements." as const;

export const HitamQuery = z.object({
  image: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar yang akan dihitamkan'),
  seed: z
    .coerce.number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe('Seed untuk reproducibility. Kosongkan untuk random.'),
});

export type HitamQuery = z.infer<typeof HitamQuery>;
