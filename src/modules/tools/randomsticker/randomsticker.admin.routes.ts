import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { randomStickerPacksRepo } from './randomsticker.repo.js';
import { invalidatePackListCache } from './randomsticker.service.js';
import { AddPackBody, PackParams, SetActiveBody } from './randomsticker.schemas.js';

const randomStickerAdminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('preHandler', app.requireMaster);

  // ── List all packs (active + inactive) ────────────────────────────────────
  app.get(
    '/',
    { schema: { hide: true, tags: ['admin'], summary: 'List all meme sticker packs (master only)', security: [{ apiKey: [] }] } },
    async () => {
      const packs = await randomStickerPacksRepo(app.supabase).list();
      return { ok: true, data: { packs } };
    },
  );

  // ── Add a pack ──────────────────────────────────────────────────────────────
  app.post(
    '/',
    {
      schema: {
        hide: true,
        tags: ['admin'],
        summary: 'Add a Telegram meme sticker pack (master only)',
        security: [{ apiKey: [] }],
        body: AddPackBody,
      },
    },
    async (req, reply) => {
      const pack = await randomStickerPacksRepo(app.supabase).add(
        req.body.name,
        req.body.label,
        req.apiKey?.id,
      );
      invalidatePackListCache();
      return reply.code(201).send({ ok: true, data: { pack } });
    },
  );

  // ── Toggle active/inactive ────────────────────────────────────────────────
  app.patch(
    '/:id',
    {
      schema: {
        hide: true,
        tags: ['admin'],
        summary: 'Activate/deactivate a meme sticker pack (master only)',
        security: [{ apiKey: [] }],
        params: PackParams,
        body: SetActiveBody,
      },
    },
    async (req) => {
      const pack = await randomStickerPacksRepo(app.supabase).setActive(req.params.id, req.body.active);
      invalidatePackListCache();
      return { ok: true, data: { pack } };
    },
  );

  // ── Remove a pack ────────────────────────────────────────────────────────
  app.delete(
    '/:id',
    {
      schema: {
        hide: true,
        tags: ['admin'],
        summary: 'Remove a meme sticker pack (master only)',
        security: [{ apiKey: [] }],
        params: PackParams,
      },
    },
    async (req, reply) => {
      await randomStickerPacksRepo(app.supabase).remove(req.params.id);
      invalidatePackListCache();
      return reply.code(204).send();
    },
  );
};

export default randomStickerAdminRoutes;
