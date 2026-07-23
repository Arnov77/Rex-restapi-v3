import { z } from 'zod';

export const CaptionBody = z
  .object({
    image_url: z.string().url().max(2048).optional().describe('Public image URL — pakai ini, image_base64, ATAU upload file'),
    image_base64: z.string().max(15_000_000).optional().describe('Gambar dalam base64 (boleh dengan atau tanpa prefix data URI)'),
    caption_text: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe('Teks yang di-overlay. Gunakan \\n untuk baris baru.'),
    position: z.enum(['top', 'center', 'bottom']).default('top').describe('Posisi vertikal teks pada gambar'),
    text_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'text_color must be a 6-digit hex like #ffffff')
      .default('#ffffff'),
    stroke_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'stroke_color must be a 6-digit hex like #000000')
      .default('#000000'),
    format: z.enum(['png', 'jpeg', 'webp']).default('jpeg'),
    quality: z.coerce.number().int().min(1).max(100).default(92),
  })
  .describe('Body JSON — kosongkan image_url dan image_base64 kalau kirim file lewat multipart/form-data field `file`.');

export type CaptionBody = z.infer<typeof CaptionBody>;

export const CaptionResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    image_base64: z.string(),
    mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
});
export type CaptionResponse = z.infer<typeof CaptionResponse>;
