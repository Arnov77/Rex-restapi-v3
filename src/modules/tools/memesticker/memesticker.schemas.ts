import { z } from 'zod';

/**
 * MEME STICKER (random)
 * Returns a random sticker from a curated list of Indonesian meme
 * sticker packs hosted on Telegram.
 */
export const MemeStickerQuery = z.object({
  format: z.enum(['jpeg', 'png', 'webp']).default('webp')
    .describe('Output format for static stickers (animated stickers always return as-is)'),
  quality: z.coerce.number().int().min(1).max(100).default(90),
  pack: z.string().trim().min(1).max(64).optional()
    .describe('Optional: force a specific pack name from the curated list instead of random'),
});

export type MemeStickerQuery = z.infer<typeof MemeStickerQuery>;

// ─── Admin schemas (manage pack list) ──────────────────────────────────────────
export const AddPackBody = z.object({
  name: z.string().trim().min(1).max(64)
    .describe('Telegram sticker pack short-name, e.g. "MemesIndonesia" (from t.me/addstickers/<name>)'),
  label: z.string().trim().max(120).optional(),
});

export const PackParams = z.object({
  id: z.string().uuid(),
});

export const SetActiveBody = z.object({
  active: z.boolean(),
});

export type AddPackBody = z.infer<typeof AddPackBody>;
export type PackParams = z.infer<typeof PackParams>;
export type SetActiveBody = z.infer<typeof SetActiveBody>;
