import { z } from 'zod';

export const FakeFFQuery = z.object({
  name: z.string().trim().min(1).max(24),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  quality: z.coerce.number().int().min(1).max(100).default(92),
});

export type FakeFFQuery = z.infer<typeof FakeFFQuery>;
