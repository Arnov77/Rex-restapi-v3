import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortlinksService } from './shortlinks.service.js';
import { CreateShortlinkBody } from './shortlinks.schemas.js';
import { usersRepo } from '@modules/auth/users.repo.js';

const shortlinksRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'shortlink',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many shortlink requests',
  });

  // Helper resolve caller identity
  async function resolveOwner(req: Parameters<typeof limit>[0]) {
    const isMaster = req.apiKey?.tier === 'master';

    // User via JWT
    if (req.user?.id) {
      return { userId: req.user.id, apiKeyId: undefined, isMaster };
    }
    // API key → lookup user
    if (req.apiKey?.id) {
      try {
        const { data } = await app.supabase
          .from('users')
          .select('id')
          .eq('api_key_id', req.apiKey.id)
          .maybeSingle();
        if (data?.id) return { userId: data.id, apiKeyId: req.apiKey.id, isMaster };
      } catch {
        // fallthrough
      }
      return { userId: undefined, apiKeyId: req.apiKey.id, isMaster };
    }
    return { userId: undefined, apiKeyId: undefined, isMaster: false };
  }

  // Middleware — require login (JWT atau API key)
  async function requireAuth(req: Parameters<typeof limit>[0], reply: Parameters<typeof limit>[1]) {
    if (!req.user && !req.apiKey) {
      return reply.code(401).send({ ok: false, error: { message: 'Login required to use shortlinks' } });
    }
  }

  // ── POST /api/shortlink — buat shortlink ────────────────────────────────────
  app.post(
    '/',
    {
      preHandler: [limit, requireAuth],
      schema: {
        tags: ['shortlink'],
        summary: 'Create a shortlink',
        body: CreateShortlinkBody,
      },
    },
    async (req, reply) => {
      const svc = shortlinksService(app.supabase);
      const owner = await resolveOwner(req as any);
      const link = await svc.create(req.body, owner);

      const base = `${req.protocol}://${req.hostname}`;
      return {
        ok: true,
        data: {
          id: link.id,
          url: link.url,
          short_url: `${base}/s/${link.id}`,
          clicks: link.clicks,
          created_at: link.created_at,
          expires_at: link.expires_at,
        },
      };
    },
  );

  // ── GET /api/shortlink — list shortlinks milik caller ──────────────────────
  app.get(
    '/',
    {
      preHandler: [limit, requireAuth],
      schema: {
        tags: ['shortlink'],
        summary: 'List your shortlinks',
      },
    },
    async (req) => {
      const svc = shortlinksService(app.supabase);
      const owner = await resolveOwner(req as any);
      const links = await svc.list(owner);
      const base = `${req.protocol}://${req.hostname}`;

      return {
        ok: true,
        data: links.map((l) => ({
          id: l.id,
          url: l.url,
          short_url: `${base}/s/${l.id}`,
          clicks: l.clicks,
          created_at: l.created_at,
          expires_at: l.expires_at,
        })),
      };
    },
  );

  // ── DELETE /api/shortlink/:id — hapus shortlink ─────────────────────────────
  app.delete(
    '/:id',
    {
      preHandler: [limit, requireAuth],
      schema: {
        tags: ['shortlink'],
        summary: 'Delete a shortlink',
        params: z.object({ id: z.string().min(1) }),
      },
    },
    async (req, reply) => {
      const svc = shortlinksService(app.supabase);
      const owner = await resolveOwner(req as any);
      await svc.delete(req.params.id, owner);
      return { ok: true };
    },
  );

  // ── GET /s/:id — redirect ───────────────────────────────────────────────────
  app.get(
    '/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const svc = shortlinksService(app.supabase);

      try {
        const link = await svc.resolve(id);
        return reply
          .header('cache-control', 'no-store')
          .redirect(301, link.url);
      } catch {
        return reply.code(404).send('Shortlink not found or expired');
      }
    },
  );
};

export default shortlinksRoutes;
