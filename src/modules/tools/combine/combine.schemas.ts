import { z } from 'zod';

export const CombineBody = z
  .object({
    images: z
      .array(z.string().min(1).max(15_000_000))
      .min(2, 'Minimum 2 images')
      .max(6, 'Maximum 6 images')
      .describe('Array gambar (URL publik atau base64), disusun sesuai `layout`'),
    layout: z
      .array(z.number().int().min(1).max(4))
      .max(4)
      .optional()
      .describe(
        'Jumlah gambar per baris, contoh [2,1] = baris 1 berisi 2 gambar sejajar, baris 2 berisi 1 gambar. Total harus sama dengan jumlah images. Kosongkan untuk tumpuk vertikal 1 per baris.',
      ),
    caption_text: z.string().trim().max(300).optional().describe('Teks banner yang di-overlay secara diagonal. Gunakan \\n untuk baris baru.'),
    position: z.enum(['top', 'center', 'bottom']).default('center').describe('Posisi vertikal banner teks pada hasil gabungan'),
    rotation: z.coerce.number().min(-45).max(45).default(-10).describe('Sudut rotasi banner teks dalam derajat'),
    text_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'text_color must be a 6-digit hex like #ffffff').default('#ffffff'),
    stroke_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'stroke_color must be a 6-digit hex like #000000').default('#000000'),
    gap: z.coerce.number().int().min(0).max(40).default(6).describe('Jarak antar gambar dalam px'),
    width: z.coerce.number().int().min(300).max(1600).default(1080).describe('Lebar hasil gabungan dalam px'),
    cell_aspect_ratio: z
      .union([
        z.number().min(0.3).max(3),
        z.array(z.number().min(0.3).max(3)).min(1),
      ])
      .default(1)
      .describe('Rasio tinggi/lebar sel grid. Satu angka berlaku untuk semua baris, atau array per baris (harus sepanjang `layout`), contoh [1.333, 0.66].'),
    format: z.enum(['png', 'jpeg', 'webp']).default('jpeg'),
    quality: z.coerce.number().int().min(1).max(100).default(92),
  })
  .superRefine((val, ctx) => {
    if (val.layout) {
      const sum = val.layout.reduce((a, b) => a + b, 0);
      if (sum !== val.images.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['layout'],
          message: `layout total (${sum}) must equal images.length (${val.images.length})`,
        });
      }
    }
  });

export type CombineBody = z.infer<typeof CombineBody>;

export const CombineResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    image_base64: z.string(),
    mime_type: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  }),
});
export type CombineResponse = z.infer<typeof CombineResponse>;