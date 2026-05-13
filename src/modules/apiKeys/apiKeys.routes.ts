import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apiKeysService } from './apiKeys.service.js';
import {
  CreateKeyBody,
  CreateKeyResponse,
  KeyIdParam,
  OkResponse,
  RevealKeyResponse,
} from './apiKeys.schemas.js';

const apiKeyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/',
    {
      preHandler: [app.requireMaster],
      schema: {
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
};

export default apiKeyRoutes;
