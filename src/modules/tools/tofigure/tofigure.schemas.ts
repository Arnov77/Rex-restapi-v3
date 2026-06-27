import { z } from 'zod';

export const TOFIGURE_STYLE = 'Style-Transfer' as const;
export const TOFIGURE_PROMPT = 'Create a 1/7 scale commercialized figurine of the characters in the picture, in a realistic style, in a real environment. The figurine is placed on a computer desk. The figurine has a round transparent acrylic base, with no text on the base. The content on the computer screen is a 3D modeling process of this figurine. Next to the computer screen is a toy packaging box, designed in a style reminiscent of high-quality collectible figures, printed with original artwork. The packaging features two-dimensional flat illustrations.' as const;

export const TofigureQuery = z.object({
  image: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('URL gambar yang akan diubah ke figure'),
  seed: z
    .coerce.number()
    .int()
    .min(0)
    .max(2147483647)
    .optional()
    .describe('Seed untuk reproducibility. Kosongkan untuk random.'),
});

export type TofigureQuery = z.infer<typeof TofigureQuery>;
