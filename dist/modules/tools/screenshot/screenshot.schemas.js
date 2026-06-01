import { z } from 'zod';
/**
 * Bounds rationale:
 *  - width 320–3840 covers small-mobile to 4K
 *  - height 240–4320 allows tall full-page captures up to 8K vertical
 *  - waitFor capped at 10s to avoid pinning the shared browser on one request
 */
export const ScreenshotQuery = z.object({
    url: z.string()
        .trim()
        .max(2048)
        .transform((v) => {
        if (!/^https?:\/\//i.test(v))
            return `https://${v}`;
        return v;
    })
        .pipe(z.string().url()),
    width: z.coerce.number().int().min(320).max(3840).default(1280),
    height: z.coerce.number().int().min(240).max(4320).default(720),
    fullPage: z.coerce.boolean().default(false),
    format: z.enum(['png', 'jpeg']).default('png'),
    quality: z.coerce.number().int().min(1).max(100).default(85),
    waitFor: z.coerce.number().int().min(0).max(10_000).default(0),
    darkMode: z.coerce.boolean().default(false),
});
//# sourceMappingURL=screenshot.schemas.js.map