import { z } from 'zod';

/**
 * Self-service shapes for the authenticated user (JWT-bearing). Mirrors the
 * admin-side schemas so a future dashboard frontend can reuse types.
 */

export const ConfirmPasswordBody = z.object({
  password: z.string().min(1).max(128),
});
export type ConfirmPasswordBody = z.infer<typeof ConfirmPasswordBody>;

/** First password for a provider-created account — no old password to prove. */
export const SetPasswordBody = z.object({
  password: z.string().min(8, 'Kata sandi minimal 8 karakter').max(200),
});
export type SetPasswordBody = z.infer<typeof SetPasswordBody>;

export const SetPasswordResponse = z.object({
  ok: z.literal(true),
});

/** Change an existing password — the old one must be proven first. */
export const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8, 'Kata sandi minimal 8 karakter').max(200),
});
export type ChangePasswordBody = z.infer<typeof ChangePasswordBody>;

export const PublicUserView = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  email: z.string(),
  apiKeyId: z.string().nullable(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  provider: z.string(),
  hasPassword: z.boolean(),
});

export const MeResponse = z.object({
  ok: z.literal(true),
  data: z.object({ user: PublicUserView }),
});

export const PublicKeyView = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(['user', 'master']),
  dailyLimit: z.number().nullable(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revoked: z.boolean(),
  revokedAt: z.string().nullable(),
});

export const MyKeyResponse = z.object({
  ok: z.literal(true),
  data: z.object({ key: PublicKeyView }),
});

export const RevealKeyResponse = z.object({
  ok: z.literal(true),
  data: z.object({ plaintext: z.string() }),
});

export const RegenerateKeyResponse = z.object({
  ok: z.literal(true),
  data: z.object({ plaintext: z.string(), key: PublicKeyView }),
});

export const UsageResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    date: z.string(), // YYYY-MM-DD UTC
    used: z.number().int().nonnegative(),
    limit: z.number().int().nullable(), // null = unlimited (master)
    remaining: z.number().int().nullable(),
    resetInSeconds: z.number().int().nonnegative(),
  }),
});
