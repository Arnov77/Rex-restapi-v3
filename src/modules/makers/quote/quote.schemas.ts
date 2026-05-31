import { z } from 'zod';

/**
 * Twitter-style quote card.
 *
 * Bounds:
 *  - text 1–500 chars: a tweet maxes at 280; we give 500 for screenshots of
 *    longer posts but cap to keep layout sane.
 *  - name/handle short and ASCII-ish — emojis are fine.
 *  - width 400–1600: 600 is the sweet spot for shareable cards.
 *  - height is auto-derived from content; we expose only width.
 *  - avatar is OPTIONAL. When provided, SSRF-guarded before browser fetch.
 */
export const QuoteQuery = z.object({
  text: z.string().trim().min(1).max(500),
  name: z.string().trim().min(1).max(50).default('Anonymous'),
  handle: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9_]+$/, 'handle must be alphanumeric/underscore')
    .default('anon'),
  avatar: z.string().url().max(2048).optional(),
  verified: z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .default('false'),
  width: z.coerce.number().int().min(400).max(1600).default(600),
  theme: z.enum(['light', 'dim', 'dark']).default('light'),
  font: z.enum(['sans', 'serif', 'mono']).default('sans'),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'accent must be a 6-digit hex like #1D9BF0')
    .default('#1D9BF0'),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  quality: z.coerce.number().int().min(1).max(100).default(92),
});
export type QuoteQuery = z.infer<typeof QuoteQuery>;
