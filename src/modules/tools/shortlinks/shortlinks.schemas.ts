import { z } from 'zod';

export const CreateShortlinkBody = z.object({
  url: z.string().url().max(2048),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/, 'Slug hanya boleh huruf, angka, - dan _')
    .optional()
    .describe('Custom slug (optional) — jika tidak diisi, auto-generate'),
  expires_in: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .describe('Expiry dalam hari (optional) — jika tidak diisi, permanent'),
});

export type CreateShortlinkBody = z.infer<typeof CreateShortlinkBody>;
