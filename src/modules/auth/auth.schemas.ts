import { z } from 'zod';

export const RegisterBody = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'username may contain letters, digits, and underscore only'),
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

export const LoginBody = z.object({
  identifier: z.string().min(1).max(255).describe('email or username'),
  password: z.string().min(1).max(128),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const AuthResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    token: z.string(),
    user: z.object({
      id: z.string(),
      username: z.string(),
      email: z.string(),
      apiKeyId: z.string().nullable(),
      createdAt: z.string(),
      lastLoginAt: z.string().nullable(),
    }),
  }),
});
