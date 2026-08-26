import { z } from 'zod';

export const TiktokStalkQuery = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9._]+$/, 'Username hanya boleh huruf, angka, titik, dan underscore')
    .describe('Username TikTok (tanpa @)'),
});
export type TiktokStalkQuery = z.infer<typeof TiktokStalkQuery>;

export const TiktokStalkResponse = z.object({
  username: z.string(),
  nickname: z.string(),
  bio: z.string(),
  avatarUrl: z.string().nullable(),
  isPrivate: z.boolean(),
  isVerified: z.boolean(),
  followers: z.number().int(),
  following: z.number().int(),
  likes: z.number().int(),
  videos: z.number().int(),
});
export type TiktokStalkResponse = z.infer<typeof TiktokStalkResponse>;
