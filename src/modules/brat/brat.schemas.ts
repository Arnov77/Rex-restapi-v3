import { z } from 'zod';

/**
 * Brat caption generator (Charli XCX-style green card).
 *
 * Bounds:
 *  - text 1–200 chars: anything longer overflows the canvas regardless of
 *    font-size auto-shrink and just produces unreadable noise.
 *  - width/height 256–2048: keeps single-tile renders under Chromium's
 *    practical canvas budget; 2048² is already ~16 MB raw RGBA.
 *  - frames 2–30 / delay 40–200ms: animated GIFs are capped to ~6s total so
 *    a single request can't pin the shared browser.
 *  - blur 0–20px: visual taste; >20 turns into a green blob.
 *  - bgImage is OPTIONAL. When provided we fetch it through Chromium with
 *    SSRF protection upstream — never trust this URL without the guard.
 */
export const BratQuery = z.object({
  text: z.string().trim().min(1).max(200),
  width: z.coerce.number().int().min(256).max(2048).default(720),
  height: z.coerce.number().int().min(256).max(2048).default(720),
  format: z.enum(['png', 'jpeg', 'gif']).default('png'),
  quality: z.coerce.number().int().min(1).max(100).default(90),
  blur: z.coerce.number().min(0).max(20).default(1.5),
  background: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'background must be a 6-digit hex like #8ACE00')
    .default('#8ACE00'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex like #000000')
    .default('#000000'),
  // Animated-only knobs — ignored for png/jpeg.
  frames: z.coerce.number().int().min(2).max(30).default(12),
  delay: z.coerce.number().int().min(40).max(200).default(80),
  bgImage: z.string().url().max(2048).optional(),
});
export type BratQuery = z.infer<typeof BratQuery>;
