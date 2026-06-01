import { z } from 'zod';
/**
 * STICKER
 * Fetch and convert Telegram stickers (single or pack).
 *
 * Input: file_id or t.me/addstickers/<name> link
 * Output: jpeg/png/webp (single) or zip/wastickers (pack)
 */
const telegramLink = z
    .string()
    .regex(/^https?:\/\/t\.me\/addstickers\/[A-Za-z0-9_]+$/, 'Must be a t.me/addstickers/<name> link');
export const StickerSingleQuery = z.object({
    input: z.string().trim().min(1).max(512)
        .describe('Telegram file_id or t.me/addstickers/<name> link'),
    format: z.enum(['jpeg', 'png', 'webp']).default('webp')
        .describe('Output format for static stickers'),
    quality: z.coerce.number().int().min(1).max(100).default(90),
});
export const StickerPackQuery = z.object({
    input: telegramLink
        .describe('t.me/addstickers/<name> link'),
    format: z.enum(['zip', 'wastickers']).default('zip')
        .describe('zip = all stickers in zip, wastickers = WhatsApp sticker pack'),
    image_format: z.enum(['jpeg', 'png', 'webp']).default('webp')
        .describe('Format for static stickers inside the archive'),
    quality: z.coerce.number().int().min(1).max(100).default(90),
});
//# sourceMappingURL=sticker.schemas.js.map