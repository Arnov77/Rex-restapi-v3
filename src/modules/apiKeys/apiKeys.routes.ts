import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiKeysService } from './apiKeys.service.js';
import { poolStats } from '../../shared/browser/browserManager.js';
import {
  CreateKeyBody,
  CreateKeyResponse,
  KeyIdParam,
  ListKeysQuery,
  ListKeysResponse,
  OkResponse,
  PoolStatsResponse,
  RegenerateKeyResponse,
  RevealKeyResponse,
  UpdateKeyBody,
  UpdateKeyResponse,
} from './apiKeys.schemas.js';

const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'List API keys (master only)',
        security: [{ apiKey: [] }],
        querystring: ListKeysQuery,
        response: { 200: ListKeysResponse },
      },
    },
    async (req) => {
      const keys = await apiKeysService(app.supabase).list({ includeRevoked: req.query.includeRevoked });
      return { ok: true as const, data: { keys } };
    },
  );

  app.post(
    '/',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'Create a new API key (master only)',
        security: [{ apiKey: [] }],
        body: CreateKeyBody,
        response: { 201: CreateKeyResponse },
      },
    },
    async (req, reply) => {
      const svc = apiKeysService(app.supabase);
      const result = await svc.create(req.body);
      return reply.code(201).send({
        ok: true as const,
        data: { plaintext: result.plaintext, key: svc.repo.publicView(result.record) },
      });
    },
  );

  app.get(
    '/:id/reveal',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'Reveal stored plaintext for a key (master only)',
        security: [{ apiKey: [] }],
        params: KeyIdParam,
        response: { 200: RevealKeyResponse },
      },
    },
    async (req) => {
      const plaintext = await apiKeysService(app.supabase).revealById(req.params.id);
      return { ok: true as const, data: { plaintext } };
    },
  );

  app.delete(
    '/:id',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'Revoke an API key (master only)',
        security: [{ apiKey: [] }],
        params: KeyIdParam,
        response: { 200: OkResponse },
      },
    },
    async (req) => {
      await apiKeysService(app.supabase).revoke(req.params.id);
      return { ok: true as const };
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'Update mutable fields on an API key (master only)',
        description:
          'Use this to upgrade/downgrade `dailyLimit` (set to `null` for unlimited) or rename a key. Other fields (tier, hash, revoked) have dedicated paths.',
        security: [{ apiKey: [] }],
        params: KeyIdParam,
        body: UpdateKeyBody,
        response: { 200: UpdateKeyResponse },
      },
    },
    async (req) => {
      const svc = apiKeysService(app.supabase);
      const updated = await svc.update(req.params.id, req.body);
      return { ok: true as const, data: { key: svc.repo.publicView(updated) } };
    },
  );

  app.post(
    '/:id/regenerate',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'Rotate the secret of an API key (master only)',
        description:
          "The key id is preserved so users.api_key_id pointers and today's quota counter survive the rotation. Plaintext is returned ONCE.",
        security: [{ apiKey: [] }],
        params: KeyIdParam,
        response: { 200: RegenerateKeyResponse },
      },
    },
    async (req) => {
      const svc = apiKeysService(app.supabase);
      const result = await svc.regenerate(req.params.id);
      return {
        ok: true as const,
        data: { plaintext: result.plaintext, key: svc.repo.publicView(result.record) },
      };
    },
  );

  // Live Chromium page-pool stats. Same auth model as the rest of
  // /api/keys/* — master-only — so we can expose internal saturation
  // numbers to the admin UI without leaking them to bot tenants.
  app.get(
    '/pool-stats',
    {
      preHandler: [app.requireMaster],
      schema: {
        hide: true,
        tags: ['api-keys'],
        summary: 'Live Chromium page-pool stats (master only)',
        security: [{ apiKey: [] }],
        response: { 200: PoolStatsResponse },
      },
    },
    async () => ({ ok: true as const, data: poolStats() }),
  );
};

export default apiKeyRoutes;
