import { z } from 'zod';
/**
 * LQ (Low Quality)
 * Degrades an image into a blurry, soft, low-detail meme aesthetic.
 * The result is intentionally smooth/blurry, not blocky pixelated.
 */
export const LqQuery = z.object({
    image: z.string().url().max(2048),
    level: z.coerce
        .number()
        .int()
        .min(1)
        .max(15)
        .default(5)
        .describe('Blurred low quality level. 1 = subtle, 5 = medium, 15 = extreme blurry low-detail'),
    format: z.enum(['png', 'jpeg', 'webp']).default('jpeg'),
    quality: z.coerce
        .number()
        .int()
        .min(1)
        .max(100)
        .default(65)
        .describe('Final output quality. Lower value = more compressed'),
});
//# sourceMappingURL=lq.schemas.js.map