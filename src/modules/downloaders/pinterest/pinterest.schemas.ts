import { z } from 'zod';

/**
 * Exact hostname match (incl. country TLDs like pinterest.co.uk) — the old
 * substring regex also accepted `pinterest.com.evil.com` and userinfo tricks.
 */
function isPinterestHost(u: string): boolean {
  try {
    const h = new URL(u).hostname.toLowerCase();
    return (
      h === 'pinterest.com' || h.endsWith('.pinterest.com') ||
      h === 'pin.it' || h.endsWith('.pin.it') ||
      /^pinterest\.[a-z]{2}$/.test(h) ||
      /^pinterest\.co\.[a-z]{2}$/.test(h)
    );
  } catch {
    return false;
  }
}

export const PinterestQuery = z.object({
  url: z.string().url().refine(isPinterestHost, { message: 'Must be a valid Pinterest URL' }),
});
export type PinterestQuery = z.infer<typeof PinterestQuery>;

const MediaItem = z.object({
  type: z.enum(['image', 'video']),
  url: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  quality: z.string().optional(),
});

export const PinterestResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    id: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    author: z.object({
      name: z.string(),
      username: z.string(),
    }),
    board: z.string().nullable(),
    thumbnail: z.string().nullable(),
    media: z.array(MediaItem),
  }),
});
