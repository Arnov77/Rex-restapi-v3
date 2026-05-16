import { z } from 'zod';

/**
 * Self-service shapes for the authenticated user (JWT-bearing). Mirrors the
 * admin-side schemas so a future dashboard frontend can reuse types.
 */

export const ConfirmPasswordBody = z.object({
  password: z.string().min(1).max(128),
});
export type ConfirmPasswordBody = z.infer<typeof ConfirmPasswordBody>;

export const PublicUserView = z.object({
  id: z.string(),
  username: z.string(),
  email: z.string(),
  apiKeyId: z.string().nullable(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
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
