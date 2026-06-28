import { z } from 'zod';

export const TOFIGURE_STYLE = 'Style-Transfer' as const;
export const TOFIGURE_PROMPT = 'A professional product photograph of a commercialized 1/7 scale high-end collectible figurine, displayed full body from head to toe on a wooden computer desk. The figurine must perfectly capture the exact facial likeness, facial structure, eye shape, and hairstyle of the specific person shown in the reference photo. The figurine is wearing the exact same outfit as shown in the reference photo, accurately replicating the style, patterns, colors, and textures of both the upper and lower clothing, including the footwear. The figure stands full-length on a completely blank, round transparent acrylic base with no text. In the background, a large computer monitor clearly displays a 3D modeling software interface showing the digital full-body sculpt of this exact figurine. Next to the monitor is a clean, premium, minimalist toy packaging box featuring a professional full-body 2D flat digital illustration of the character. Hyper-detailed, realistic materials, sharp focus, cinematic studio lighting. The image must be a full-body shot; do not create a bust shot or cut off the legs. The image must be completely free from generic anime faces, gibberish text, unreadable words, blurry letters, or distorted fonts on the box. The packaging must look professional without any childish drawings or random doodles.' as const;

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
