import { z } from 'zod';

export const CreateKeyBody = z.object({
  name: z.string().min(1).max(128),
  tier: z.enum(['user', 'master']).default('user'),
  dailyLimit: z.number().int().nonnegative().nullable().optional(),
  storeEncrypted: z.boolean().optional(),
});
export type CreateKeyBody = z.infer<typeof CreateKeyBody>;

export const KeyIdParam = z.object({ id: z.string().uuid() });
export type KeyIdParam = z.infer<typeof KeyIdParam>;

export const PublicKey = z.object({
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

export const CreateKeyResponse = z.object({
  ok: z.literal(true),
  data: z.object({ plaintext: z.string(), key: PublicKey }),
});

export const RevealKeyResponse = z.object({
  ok: z.literal(true),
  data: z.object({ plaintext: z.string() }),
});

export const OkResponse = z.object({ ok: z.literal(true) });

export const ListKeysQuery = z.object({
  includeRevoked: z.coerce.boolean().optional().default(false),
});
export type ListKeysQuery = z.infer<typeof ListKeysQuery>;

export const ListKeysResponse = z.object({
  ok: z.literal(true),
  data: z.object({ keys: z.array(PublicKey) }),
});

export const UpdateKeyBody = z
  .object({
    name: z.string().min(1).max(128).optional(),
    // Allow null explicitly so callers can opt INTO unlimited.
    dailyLimit: z.number().int().nonnegative().nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.dailyLimit !== undefined, {
    message: 'Provide at least one field to update (name, dailyLimit)',
  });
export type UpdateKeyBody = z.infer<typeof UpdateKeyBody>;

export const UpdateKeyResponse = z.object({
  ok: z.literal(true),
  data: z.object({ key: PublicKey }),
});
