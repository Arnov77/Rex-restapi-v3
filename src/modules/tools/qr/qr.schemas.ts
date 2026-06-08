import { z } from 'zod';

export const QrQuery = z.object({
  query: z.string().min(1).max(2048).describe('Teks, URL, atau data lain yang akan di-encode'),
  size: z.coerce.number().int().min(100).max(1024).default(300).describe('Ukuran gambar dalam px (default: 300)'),
  format: z.enum(['png', 'svg']).default('png').describe('Format output (default: png)'),
  color: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/, 'Warna harus format hex 6 karakter, contoh: 000000')
    .default('000000')
    .describe('Warna QR code dalam hex (default: 000000)'),
  bg: z
    .string()
    .regex(/^[0-9a-fA-F]{6}$/, 'Warna harus format hex 6 karakter, contoh: ffffff')
    .default('ffffff')
    .describe('Warna background dalam hex (default: ffffff)'),
});

export type QrQuery = z.infer<typeof QrQuery>;
