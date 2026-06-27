import { z } from 'zod';

export const TOFIGURE_STYLE = 'Style-Transfer' as const;
export const TOFIGURE_PROMPT = 'A professional commercial product photograph of a premium 1/7 scale anime girl figurine in camouflage pants, displayed on a wooden computer desk. The figurine stands on a flawless, perfectly round transparent acrylic base with absolutely no text or writing. In the background, a computer monitor clearly displays a 3D modeling software interface of this figurine. Next to the monitor is its collectible packaging box, designed in a sleek, premium, minimalist style featuring only a clean 2D flat illustration of the anime character. The image must be free from any gibberish text, unreadable letters, or random words. The packaging box must not have any childish colorful cartoon doodles or messy drawings; it must look like a high-end, professional product. Sharp focus, realistic textures.' as const;

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
