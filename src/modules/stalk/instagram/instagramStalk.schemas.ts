import { z } from 'zod';

export const InstagramStalkQuery = z.object({
  username: z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z0-9._]+$/, 'Username hanya boleh huruf, angka, titik, dan underscore')
    .describe('Username Instagram (tanpa @)'),
});
export type InstagramStalkQuery = z.infer<typeof InstagramStalkQuery>;

export const InstagramStalkResponse = z.object({
  username: z.string(),
  fullName: z.string(),
  bio: z.string(),
  externalUrl: z.string().nullable(),
  profilePicUrl: z.string().nullable(),
  isPrivate: z.boolean(),
  isVerified: z.boolean(),
  followers: z.number().int(),
  following: z.number().int(),
  posts: z.number().int(),
});
export type InstagramStalkResponse = z.infer<typeof InstagramStalkResponse>;
