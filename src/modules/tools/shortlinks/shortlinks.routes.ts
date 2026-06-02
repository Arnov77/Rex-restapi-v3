import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { shortlinksService } from './shortlinks.service.js';
import { CreateShortlinkBody } from './shortlinks.schemas.js';
import { loadEnv } from '../../../config/env.js';

/**
 * Build the public short URL for a slug.
 *  - With SHORTLINK_BASE_URL set (e.g. https://short.example.com): use that
 *    origin at the ROOT path → https://short.example.com/<id>
 *  - Otherwise: fall back to the API request host at /s/<id>.
 */
function buildShortUrl(req: { protocol: string; hostname: string }, id: string): string {
  const base = loadEnv().SHORTLINK_BASE_URL;
  if (base) return `${base}/${id}`;
  return `${req.protocol}://${req.hostname}/s/${id}`;
}

const shortlinksRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'shortlink',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many shortlink requests',
  });

  async function resolveOwner(req: Parameters<typeof limit>[0]) {
    const isMaster = req.apiKey?.tier === 'master';
    if (req.user?.id) {
      return { userId: req.user.id, apiKeyId: undefined, isMaster };
    }
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

  async function requireAuth(req: Parameters<typeof limit>[0], reply: Parameters<typeof limit>[1]) {
    if (!req.user && !req.apiKey) {
      return reply.code(401).send({ ok: false, error: { message: 'Login required to use shortlinks' } });
    }
  }

  // POST /api/shortlink — buat shortlink
  app.post(
    '/',
    {
      preHandler: [limit, requireAuth],
      schema: { tags: ['shortlink'], summary: 'Create a shortlink', body: CreateShortlinkBody },
    },
    async (req) => {
      const svc = shortlinksService(app.supabase);
      const owner = await resolveOwner(req as any);
      const link = await svc.create(req.body, owner);

      return {
        ok: true,
        data: {
          id: link.id,
          url: link.url,
          short_url: buildShortUrl(req, link.id),
          clicks: link.clicks,
          created_at: link.created_at,
          expires_at: link.expires_at,
        },
      };
    },
  );

  // GET /api/shortlink — list milik caller
  app.get(
    '/',
    {
      preHandler: [limit, requireAuth],
      schema: { tags: ['shortlink'], summary: 'List your shortlinks' },
    },
    async (req) => {
      const svc = shortlinksService(app.supabase);
      const owner = await resolveOwner(req as any);
      const links = await svc.list(owner);

      return {
        ok: true,
        data: links.map((l) => ({
          id: l.id,
          url: l.url,
          short_url: buildShortUrl(req, l.id),
          clicks: l.clicks,
          created_at: l.created_at,
          expires_at: l.expires_at,
        })),
      };
    },
  );

  // DELETE /api/shortlink/:id
  app.delete(
    '/:id',
    {
      preHandler: [limit, requireAuth],
      schema: { tags: ['shortlink'], summary: 'Delete a shortlink', params: z.object({ id: z.string().min(1) }) },
    },
    async (req) => {
      const svc = shortlinksService(app.supabase);
      const owner = await resolveOwner(req as any);
      await svc.delete(req.params.id, owner);
      return { ok: true };
    },
  );

  // GET /api/shortlink/:id — redirect (di bawah prefix /api/shortlink)
  app.get(
    '/:id',
    { schema: { hide: true } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const svc = shortlinksService(app.supabase);
      try {
        const link = await svc.resolve(id);
        return reply.header('cache-control', 'no-store').redirect(link.url, 301);
      } catch {
        return reply.code(404).send('Shortlink not found or expired');
      }
    },
  );
};

export default shortlinksRoutes;
