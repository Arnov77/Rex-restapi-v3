import { z } from 'zod';
/**
 * QC (Quote Chat)
 * Renders a WhatsApp-style incoming chat bubble with sender name.
 */
export const QcQuery = z.object({
    text: z.string().trim().max(500),
    name: z.string().trim().max(100),
    avatar: z.string().url().max(2048).optional(),
    theme: z.enum(['dark', 'light']).default('dark'),
    time: z
        .string()
        .trim()
        .regex(/^\d{1,2}[:.]\d{2}(\s?(AM|PM))?$/i, 'time must look like 23.26, 11.11, or 2.01 PM')
        .default('19.17'),
    format: z.enum(['png', 'jpeg', 'webp']).default('png'),
    quality: z.coerce.number().int().min(1).max(100).default(92),
});
//# sourceMappingURL=qc.schemas.js.map