import { z } from 'zod';

/**
 * Exact hostname match — the old substring regex also accepted
 * `facebook.com.evil.com` and userinfo tricks like `facebook.com@169.254.169.254`.
 */
function isFacebookHost(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      h === 'facebook.com' || h.endsWith('.facebook.com') ||
      h === 'fb.watch' || h.endsWith('.fb.watch') ||
      h === 'fb.com' || h.endsWith('.fb.com') ||
      h === 'fbcdn.net' || h.endsWith('.fbcdn.net')
    );
  } catch {
    return false;
  }
}

export const FacebookQuery = z.object({
  url: z.string().url().refine(isFacebookHost, { message: 'Must be a valid Facebook URL' }),
});
export type FacebookQuery = z.infer<typeof FacebookQuery>;

const MediaItem = z.object({
  type: z.enum(['video', 'image']),
  url: z.string(),
  quality: z.string().optional(),
});

export const FacebookResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    title: z.string(),
    author: z.object({
      name: z.string(),
      username: z.string(),
    }),
    thumbnail: z.string().nullable(),
    duration: z.number().nullable(),
    media: z.array(MediaItem),
  }),
});
