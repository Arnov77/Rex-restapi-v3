import { z } from 'zod';

export const CekKodamQuery = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nama tidak boleh kosong')
    .max(64, 'Nama maksimal 64 karakter')
    .describe('Nama orang yang mau dicek khodamnya'),
  random: z
    .coerce
    .boolean()
    .optional()
    .default(false)
    .describe('Jika true, hasil acak murni (tidak deterministik berdasarkan nama)'),
});

export type CekKodamQuery = z.infer<typeof CekKodamQuery>;

export const CekKodamResponse = z.object({
  name: z.string(),
  khodam: z.string(),
  description: z.string(),
  power: z.number().int().min(1).max(100),
  element: z.string(),
  message: z.string(),
});

export type CekKodamResponse = z.infer<typeof CekKodamResponse>;