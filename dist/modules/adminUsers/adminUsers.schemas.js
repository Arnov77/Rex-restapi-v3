import { z } from 'zod';
export const ListUsersQuery = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    search: z.string().optional(),
});
export const PublicUserSchema = z.object({
    id: z.string(),
    username: z.string(),
    email: z.string(),
    apiKeyId: z.string().nullable(),
    createdAt: z.string(),
    lastLoginAt: z.string().nullable(),
});
export const ListUsersResponse = z.object({
    ok: z.literal(true),
    data: z.object({
        users: z.array(PublicUserSchema),
        total: z.number().int().nonnegative(),
    }),
});
//# sourceMappingURL=adminUsers.schemas.js.map