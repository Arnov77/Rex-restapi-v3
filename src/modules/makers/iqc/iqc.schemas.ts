import { z } from 'zod';

/**
 * IQC (iPhone Quote Chat)
 *
 * Public params:
 * - type=chat            -> text required
 * - type=sticker/media   -> media required, text optional as caption
 */
export const IqcQuery = z
  .object({
    type: z.enum(['chat', 'sticker', 'media']).default('chat'),
    text: z.string().trim().max(500).optional(),
    media: z.string().url().max(2048).optional(),
    time: z
      .string()
      .trim()
      .regex(/^\d{1,2}[:.]\d{2}(\s?(AM|PM))?$/i, 'time must look like 23.26, 11.11, or 2.01 PM')
      .default('23.26'),
    format: z.enum(['png', 'jpeg', 'webp']).default('png'),
    quality: z.coerce.number().int().min(1).max(100).default(92),
  })
  .superRefine((val, ctx) => {
    if (val.type === 'chat' && !val.text?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'text is required when type=chat',
      });
    }

    if ((val.type === 'sticker' || val.type === 'media') && !val.media) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['media'],
        message: 'media is required when type=sticker or type=media',
      });
    }
  });

export type IqcQuery = z.infer<typeof IqcQuery>;