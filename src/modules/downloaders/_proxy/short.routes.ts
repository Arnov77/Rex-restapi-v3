/**
 * Short URL proxy route — GET /p/:id
 *
 * Resolves a short ID to the stored signed proxy token, verifies it,
 * then streams the upstream media to the client. Reuses the same
 * SSRF/size-hardened streaming logic as /api/download/proxy
 * (see `streamProxy.ts`) but with a much shorter URL.
 */

import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { get as getShortToken } from './short-store.js';
import { verifyProxyToken } from './proxy.token.js';
import { streamProxyResponse } from './streamProxy.js';

const ShortParams = z.object({
  id: z.string().min(1),
});

const shortRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/:id',
    {
      schema: {
        hide: true,
        tags: ['download'],
        summary: 'Stream media via short proxy URL',
        params: ShortParams,
      },
    },
    async (req, reply) => {
      // 1. Resolve short ID → token
      const token = getShortToken(req.params.id);
      if (!token) {
        return reply.code(404).send({ ok: false, error: { message: 'Link expired or not found' } });
      }

      // 2. Verify token signature + expiry
      const payload = verifyProxyToken(token);
      if (!payload) {
        return reply.code(403).send({ ok: false, error: { message: 'Invalid or expired token' } });
      }

      // 3. Stream from upstream (SSRF + size hardened)
      return streamProxyResponse(req, reply, payload, 'short proxy');
    },
  );
};

export default shortRoutes;
