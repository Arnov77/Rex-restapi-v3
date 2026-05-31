import { z } from 'zod';

/**
 * MIQ (Make It Quote)
 * Renders a stylized quote card with image, text, name, and username.
 */
export const MiqQuery = z.object({
  text: z.string().trim().max(300),
  name: z.string().trim().max(100),
  username: z.string().trim().max(100),
  image: z.string().url().max(2048),
  orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  image_filter: z.enum(['grayscale', 'color']).default('grayscale'),
  format: z.enum(['png', 'jpeg', 'webp']).default('jpeg'),
  quality: z.coerce.number().int().min(1).max(100).default(92),
});

export type MiqQuery = z.infer<typeof MiqQuery>;
