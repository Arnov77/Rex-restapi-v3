import { z } from 'zod';

export const WetonQuery = z.object({
  tanggal: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD')
    .describe('Tanggal lahir format YYYY-MM-DD'),
});
export type WetonQuery = z.infer<typeof WetonQuery>;

export const WetonResponse = z.object({
  tanggal: z.string(),
  hari: z.string(),
  pasaran: z.string(),
  weton: z.string(),
  neptu: z.object({
    hari: z.number().int(),
    pasaran: z.number().int(),
    total: z.number().int(),
  }),
  watak: z.string(),
});
export type WetonResponse = z.infer<typeof WetonResponse>;

export const JodohQuery = z.object({
  nama1: z.string().trim().min(1).max(64).describe('Nama pasangan pertama'),
  nama2: z.string().trim().min(1).max(64).describe('Nama pasangan kedua'),
});
export type JodohQuery = z.infer<typeof JodohQuery>;

export const JodohResponse = z.object({
  nama1: z.string(),
  nama2: z.string(),
  kecocokan: z.number().int().min(0).max(100),
  kategori: z.string(),
  arti: z.string(),
  pesan: z.string(),
});
export type JodohResponse = z.infer<typeof JodohResponse>;

export const ArtiNamaQuery = z.object({
  nama: z.string().trim().min(1).max(64).describe('Nama yang mau dicari artinya'),
});
export type ArtiNamaQuery = z.infer<typeof ArtiNamaQuery>;

export const ArtiNamaResponse = z.object({
  nama: z.string(),
  arti: z.string(),
  sifat: z.string(),
  keberuntungan: z.object({
    warna: z.string(),
    angka: z.number().int(),
    hari: z.string(),
  }),
});
export type ArtiNamaResponse = z.infer<typeof ArtiNamaResponse>;

export const ShioQuery = z.object({
  tahun: z.coerce.number().int().min(1900).max(2100).describe('Tahun lahir'),
});
export type ShioQuery = z.infer<typeof ShioQuery>;

export const ShioResponse = z.object({
  tahun: z.number().int(),
  shio: z.string(),
  elemen: z.string(),
  sifat: z.string(),
  keberuntungan: z.string(),
});
export type ShioResponse = z.infer<typeof ShioResponse>;