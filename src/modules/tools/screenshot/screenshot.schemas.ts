import { z } from 'zod';

/**
 * Bounds rationale:
 *  - width 320–3840 covers small-mobile to 4K
 *  - height 240–4320 allows tall full-page captures up to 8K vertical
 *  - waitFor capped at 10s to avoid pinning the shared browser on one request
 */
/**
 * Boolean dari query string: JANGAN z.coerce.boolean() — 'false' (string)
 * jadi Boolean('false') = true. Bot kirim fullPage=false malah jadi full
 * page (dan darkMode=false malah jadi dark). Preprocess parsing teks
 * 'true'/'false' dengan benar; boolean asli tetap diterima.
 * (z.stringbool() belum ada di zod 3.25 yang terpasang.)
 */
const queryBoolean = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v),
  z.boolean(),
).default(false);

export const ScreenshotQuery = z.object({
  url: z.string()
  .trim()
  .max(2048)
  .transform((v) => {
    if (!/^https?:\/\//i.test(v)) return `https://${v}`;
    return v;
  })
  .pipe(z.string().url()),
  width: z.coerce.number().int().min(320).max(3840).default(1280),
  height: z.coerce.number().int().min(240).max(4320).default(720),
  fullPage: queryBoolean,
  format: z.enum(['png', 'jpeg']).default('png'),
  quality: z.coerce.number().int().min(1).max(100).default(85),
  waitFor: z.coerce.number().int().min(0).max(10_000).default(0),
  darkMode: queryBoolean,
});
export type ScreenshotQuery = z.infer<typeof ScreenshotQuery>;
