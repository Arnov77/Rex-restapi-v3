import { z } from 'zod';

export const SttQuery = z.object({
  url: z.string().url().max(2048).optional().describe('URL audio publik — gunakan ini ATAU upload file'),
  language: z.string().length(2).optional().describe('Kode bahasa ISO-639-1, contoh: id, en, ja (opsional, auto-detect kalau kosong)'),
});

export type SttQuery = z.infer<typeof SttQuery>;

export const SttResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    text: z.string(),
    language: z.string().nullable(),
    duration: z.number().nullable(),
  }),
});
