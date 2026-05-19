import { z } from 'zod';

export const AuditActionEnum = z.enum([
  'key.created',
  'key.revoked',
  'key.activated',
  'key.regenerated',
  'key.updated',
]);

export const AuditEntrySchema = z.object({
  id: z.string(),
  action: AuditActionEnum,
  targetKeyId: z.string(),
  targetKeyName: z.string(),
  actorKeyId: z.string(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});

export const ListAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  action: AuditActionEnum.optional(),
  targetKeyId: z.string().uuid().optional(),
});
export type ListAuditQuery = z.infer<typeof ListAuditQuery>;

export const ListAuditResponse = z.object({
  ok: z.literal(true),
  data: z.object({
    entries: z.array(AuditEntrySchema),
    total: z.number().int().nonnegative(),
  }),
});
