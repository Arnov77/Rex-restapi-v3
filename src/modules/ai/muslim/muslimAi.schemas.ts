import { z } from 'zod';

export const MuslimAiQuery = z.object({
  text: z.string().min(1).max(2000).describe('Pertanyaan atau pesan untuk Udin'),
  session: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Session ID hanya boleh huruf, angka, underscore, dan dash')
    .optional()
    .describe('Session ID custom. Kosongkan untuk auto-generate session baru (akan di-return di response).'),
});

export const MuslimAiResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    reply: z.string().describe('Balasan dari Ustadz AI'),
    session: z.string().describe('Session ID — simpan ini untuk lanjutin percakapan'),
    expires_at: z.string().describe('Waktu session expired (ISO 8601), 24 jam dari pesan terakhir'),
    history_length: z.number().int().describe('Jumlah pesan dalam history (user + assistant)'),
  }),
});

export type MuslimAiQuery = z.infer<typeof MuslimAiQuery>;
export type MuslimAiResponse = z.infer<typeof MuslimAiResponse>;
