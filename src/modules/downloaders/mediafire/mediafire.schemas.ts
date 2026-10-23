import { z } from 'zod';

/**
 * Exact hostname match — the old substring regex also accepted
 * `mediafire.com.evil.com` and userinfo tricks like `mediafire.com@169.254.169.254`.
 */
function isMediafireHost(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return h === 'mediafire.com' || h.endsWith('.mediafire.com');
  } catch {
    return false;
  }
}

export const MediafireQuery = z.object({
  url: z.string().url().refine(isMediafireHost, { message: 'Must be a valid MediaFire URL' }),
});
export type MediafireQuery = z.infer<typeof MediafireQuery>;

export const MediafireResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    filename: z.string(),
    size: z.string().nullable(),
    mimetype: z.string().nullable(),
    uploadedAt: z.string().nullable(),
    downloadUrl: z.string(),
  }),
});
