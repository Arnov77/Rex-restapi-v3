import { z } from 'zod';

export const HeruInput = z.object({
  text: z.string().min(1).max(2000).describe('Pesan untuk karakter AI'),
  session: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Session ID hanya boleh huruf, angka, underscore, dan dash')
    .optional()
    .describe('Session ID untuk lanjut percakapan. Kosongkan untuk mulai session baru.'),
  name: z
    .string()
    .min(1)
    .max(50)
    .optional()
    .describe('Nama karakter (default: Heru)'),
  persona: z
    .string()
    .max(1000)
    .optional()
    .describe('Preset (tongkrongan, teman_curhat, asisten_santai, partner_diskusi) atau deskripsi kustom'),
  tone: z
    .string()
    .max(1000)
    .optional()
    .describe('Preset (santai, formal, sarkas, tsundere, ramah) atau gaya bicara kustom'),
  defense_rules: z
    .string()
    .max(2000)
    .optional()
    .describe('Preset (strict_denial, honest_ai, candaan, none) atau aturan proteksi kustom'),
  custom_instructions: z
    .string()
    .max(2000)
    .optional()
    .describe('Instruksi atau batasan khusus tambahan untuk karakter'),
  system_prompt: z
    .string()
    .max(5000)
    .optional()
    .describe('Override penuh seluruh system prompt'),
});

export const HeruQuery = HeruInput;
export const HeruBody = HeruInput;

export const HeruResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    reply: z.string().describe('Balasan dari Heru'),
    session: z.string().describe('Session ID: simpan untuk lanjutin chat'),
    expires_at: z.string().describe('Waktu session expired (ISO 8601), 24 jam dari pesan terakhir'),
    history_length: z.number().int().describe('Jumlah pesan dalam history'),
  }),
});

export type HeruInput = z.infer<typeof HeruInput>;
export type HeruQuery = z.infer<typeof HeruQuery>;
export type HeruBody = z.infer<typeof HeruBody>;
export type HeruResponse = z.infer<typeof HeruResponse>;