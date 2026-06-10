import { z } from 'zod';

export const TranslateQuery = z.object({
  text: z.string().min(1).max(5000).describe('Teks yang ingin diterjemahkan'),
  to: z.string().min(2).max(10).describe('Bahasa target, contoh: id, en, ja, ko, ar'),
  from: z.string().min(2).max(10).optional().describe('Bahasa sumber (opsional, auto-detect kalau kosong)'),
});

export type TranslateQuery = z.infer<typeof TranslateQuery>;

export const TranslateResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    text: z.string(),
    from: z.string().nullable(),
    to: z.string(),
  }),
});
