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

/** Exchange a Supabase Auth session for a Rex API token. */
export const OAuthBody = z.object({
  accessToken: z.string().min(10).max(4096),
});
export type OAuthBody = z.infer<typeof OAuthBody>;

export const ForgotPasswordBody = z.object({
  email: z.string().email().max(255),
});

export const ResetPasswordBody = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(128),
});

export const OkResponse = z.object({ ok: z.literal(true) });

export const CheckResetBody = z.object({
  token: z.string().min(20).max(200),
});

export const CheckResetResponse = z.object({
  ok: z.literal(true),
  data: z.object({ valid: z.boolean() }),
});
