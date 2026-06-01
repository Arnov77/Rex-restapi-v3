import { z } from 'zod';
/**
 * EXIF
 * Extract metadata from an image URL.
 */
export const ExifQuery = z.object({
    image: z.string().url().max(2048),
});
//# sourceMappingURL=exif.schemas.js.map