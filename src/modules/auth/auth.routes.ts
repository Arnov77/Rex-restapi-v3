import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authService } from './auth.service.js';
import { AuthResponse, LoginBody, RegisterBody } from './auth.schemas.js';

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // Tight rate-limit on auth endpoints — separate buckets per IP and per
  // identifier so credential-stuffing across many usernames is still capped.
  const ipLimit = app.rateLimit({
    prefix: 'auth-ip',
    windowSec: 60,
    max: 20,
    keyGenerator: (req) => req.ip,
    message: 'Too many auth attempts from this IP',
  });

  app.post(
    '/register',
    {
      preHandler: [ipLimit],
      schema: {
        tags: ['auth'],
        summary: 'Create a new account',
        body: RegisterBody,
        response: { 201: AuthResponse },
      },
    },
    async (req, reply) => {
      const result = await authService(app.supabase).register(req.body);
      return reply.code(201).send({ ok: true as const, data: result });
    },
  );

  app.post(
    '/login',
    {
      preHandler: [ipLimit],
      schema: {
        tags: ['auth'],
        summary: 'Exchange credentials for a JWT',
        body: LoginBody,
        response: { 200: AuthResponse },
      },
    },
    async (req) => {
      const result = await authService(app.supabase).login(req.body);
      return { ok: true as const, data: result };
    },
  );
};

export default authRoutes;
