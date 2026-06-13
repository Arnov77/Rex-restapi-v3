import { z } from 'zod';

export const AchievementQuery = z.object({
  title: z.string().trim().min(1).max(40).default('Achievement Get!'),
  text: z.string().trim().min(1).max(90).default('You made an API request'),
  icon: z.string().trim().min(1).max(64).default('diamond'),
  format: z.enum(['png', 'jpeg', 'webp']).default('png'),
  quality: z.coerce.number().int().min(1).max(100).default(92),
});

export type AchievementQuery = z.infer<typeof AchievementQuery>;
