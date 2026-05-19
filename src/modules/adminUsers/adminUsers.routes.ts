import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { usersRepo } from '../auth/users.repo.js';
import { ListUsersQuery, ListUsersResponse } from './adminUsers.schemas.js';

const adminUsersRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['admin-users'],
        summary: 'List all users (master only)',
        security: [{ apiKey: [] }],
        querystring: ListUsersQuery,
        response: { 200: ListUsersResponse },
      },
    },
    async (req) => {
      const repo = usersRepo(app.supabase);
      const result = await repo.list({
        limit: req.query.limit,
        offset: req.query.offset,
        search: req.query.search,
      });
      return { ok: true as const, data: result };
    },
  );
};

export default adminUsersRoutes;
