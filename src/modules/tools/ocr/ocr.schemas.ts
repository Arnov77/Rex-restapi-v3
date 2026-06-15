import { z } from 'zod';

export const OcrQuery = z.object({
  image: z
    .string()
    .url()
    .max(2048)
    .optional()
    .describe('Public image URL — gunakan ini ATAU upload file di body'),
  lang: z
    .string()
    .max(10)
    .optional()
    .describe(
      'Hint bahasa teks di gambar (opsional). Contoh: "id" (Indonesia), "en" (English), "ja" (Jepang). Default: auto-detect.',
    ),
});

export const OcrResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    text: z.string().describe('Teks hasil OCR'),
    language: z.string().nullable().describe('Bahasa yang terdeteksi (ISO 639-1), null jika tidak bisa dideteksi'),
    confidence: z.enum(['high', 'medium', 'low']).nullable().describe('Tingkat kepercayaan hasil OCR'),
    lines: z.number().int().nullable().describe('Jumlah baris teks yang ditemukan'),
  }),
});

export type OcrQuery = z.infer<typeof OcrQuery>;
export type OcrResponse = z.infer<typeof OcrResponse>;
