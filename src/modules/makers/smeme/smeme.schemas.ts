import { z } from 'zod';

/**
 * SMEME (Simple Meme)
 * Renders a classic meme with top/bottom Impact text over an image.
 */
export const SmemeQuery = z
  .object({
    image: z.string().url().max(2048),
    top: z.string().trim().max(200).optional(),
    bottom: z.string().trim().max(200).optional(),
    format: z.enum(['png', 'jpeg', 'webp']).default('jpeg'),
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
