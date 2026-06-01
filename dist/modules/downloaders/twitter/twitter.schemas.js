import { z } from 'zod';
export const TwitterQuery = z.object({
    url: z.string().url().refine((u) => /twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com/i.test(u), { message: 'Must be a valid Twitter/X URL' }),
});
const MediaItem = z.object({
    type: z.enum(['video', 'image', 'gif']),
    url: z.string(),
    quality: z.string().optional(),
});
export const TwitterResponse = z.object({
    ok: z.literal(true),
    data: z.object({
        title: z.string(),
        author: z.object({
            name: z.string(),
            username: z.string(),
        }),
        thumbnail: z.string().nullable(),
        media: z.array(MediaItem),
    }),
});
//# sourceMappingURL=twitter.schemas.js.map