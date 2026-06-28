import { z } from 'zod';

export const HeruQuery = z.object({
  text: z.string().min(1).max(2000).describe('Pesan untuk Heru'),
  session: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Session ID hanya boleh huruf, angka, underscore, dan dash')
    .optional()
    .describe('Session ID untuk lanjut percakapan. Kosongkan untuk mulai session baru.'),
});

export const HeruResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    reply: z.string().describe('Balasan dari Heru'),
    session: z.string().describe('Session ID — simpan untuk lanjutin chat'),
    expires_at: z.string().describe('Waktu session expired (ISO 8601), 24 jam dari pesan terakhir'),
    history_length: z.number().int().describe('Jumlah pesan dalam history'),
  }),
});

export type HeruQuery = z.infer<typeof HeruQuery>;
export type HeruResponse = z.infer<typeof HeruResponse>;