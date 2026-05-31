import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { meService } from './me.service.js';
import { apiKeysService } from '../apiKeys/apiKeys.service.js';
import {
  ConfirmPasswordBody,
  MeResponse,
  MyKeyResponse,
  RegenerateKeyResponse,
  RevealKeyResponse,
  UsageResponse,
} from './me.schemas.js';
import { Unauthorized } from '@shared/errors.js';

/**
 * Self-service routes for the authenticated user. All require a valid JWT
 * (set on register/login). Read-only endpoints just need the JWT; secret-
 * revealing or destructive ones additionally re-verify the password.
 *
 * Why JWT not API key: API keys live in the request the bot is making to
 * us. A user managing their own key from a future dashboard is a different
 * audience — they'll log in, get a JWT, and only then look up keys.
 */

const meRoutes: FastifyPluginAsyncZod = async (app) => {
  // Tight per-IP limit on auth-adjacent endpoints. Same shape as auth
  // routes — credential brute-force across many users still gets capped.
  const ipLimit = app.rateLimit({
    prefix: 'me-ip',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.ip,
    message: 'Too many requests',
  });

  function userId(req: { user: { id: string } | null }): string {
    if (!req.user) throw Unauthorized('Authentication required');
    return req.user.id;
  }

  app.get(
    '/',
    {
      preHandler: [app.authenticate, ipLimit],
      schema: {
        hide: true,
        tags: ['me'],
        summary: 'Get the authenticated user profile',
        security: [{ bearerAuth: [] }],
        response: { 200: MeResponse },
      },
    },
    async (req) => {
      const user = await meService(app.supabase).getMe(userId(req));
      return { ok: true as const, data: { user } };
    },
  );

  app.get(
    '/key',
    {
      preHandler: [app.authenticate, ipLimit],
      schema: {
        hide: true,
        tags: ['me'],
        summary: "Get the authenticated user's API key (no plaintext)",
        security: [{ bearerAuth: [] }],
        response: { 200: MyKeyResponse },
      },
    },
    async (req) => {
      const key = await meService(app.supabase).getKey(userId(req));
      return { ok: true as const, data: { key } };
    },
  );

  app.post(
    '/key/reveal',
    {
      preHandler: [app.authenticate, ipLimit],
      schema: {
        hide: true,
        tags: ['me'],
        summary: "Reveal the plaintext of the user's API key (password required)",
        description:
          'Self-provisioned user keys are not stored encrypted by default. If reveal returns 404, regenerate to get a new plaintext.',
        security: [{ bearerAuth: [] }],
        body: ConfirmPasswordBody,
        response: { 200: RevealKeyResponse },
      },
    },
    async (req) => {
      const plaintext = await meService(app.supabase).revealKey(userId(req), req.body.password);
      return { ok: true as const, data: { plaintext } };
    },
  );

  app.post(
    '/key/regenerate',
    {
      preHandler: [app.authenticate, ipLimit],
      schema: {
        hide: true,
        tags: ['me'],
        summary: "Rotate the secret of the user's API key (password required)",
        description:
          'The same key id is reused, so today\'s usage counter persists — rotating the secret does not give a free quota reset.',
        security: [{ bearerAuth: [] }],
        body: ConfirmPasswordBody,
        response: { 200: RegenerateKeyResponse },
      },
    },
    async (req) => {
      const result = await meService(app.supabase).regenerateKey(userId(req), req.body.password);
      const view = apiKeysService(app.supabase).repo.publicView(result.record);
      return { ok: true as const, data: { plaintext: result.plaintext, key: view } };
    },
  );

  app.get(
    '/usage',
    {
      preHandler: [app.authenticate, ipLimit],
      schema: {
        hide: true,
        tags: ['me'],
        summary: "Today's usage for the authenticated user",
        description: 'UTC daily bucket. limit/remaining are null when the tier has unlimited quota (master).',
        security: [{ bearerAuth: [] }],
        response: { 200: UsageResponse },
      },
    },
    async (req) => {
      const usage = await meService(app.supabase).getUsage(userId(req));
      return { ok: true as const, data: usage };
    },
  );
};

export default meRoutes;
