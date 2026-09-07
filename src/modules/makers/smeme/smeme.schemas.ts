import { z } from 'zod';

export const SmemeQuery = z
  .object({
    url: z.string().url().max(2048).optional().describe('URL gambar/GIF/video publik — gunakan ini ATAU upload file'),
    top: z.string().trim().max(200).optional(),
    bottom: z.string().trim().max(200).optional(),
    quality: z.coerce.number().int().min(1).max(100).default(92),
  })
  .superRefine((val, ctx) => {
    if (!val.top && !val.bottom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['top'],
        message: 'at least one of top or bottom is required',
      });
    }
  });

export type SmemeQuery = z.infer<typeof SmemeQuery>;

// Format hasil berdasarkan input
export type SmemeFormat = 'jpeg' | 'gif' | 'mp4';
