import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authService } from './auth.service.js';
import {
  AuthResponse, CheckResetBody, CheckResetResponse, ForgotPasswordBody, LoginBody, OAuthBody,
  OkResponse, RegisterBody, ResetPasswordBody,
} from './auth.schemas.js';
import { passwordResetService } from './passwordReset.service.js';
import { Unauthorized } from '@shared/errors.js';

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // Tight rate-limit on auth endpoints — separate buckets per IP and per
  // identifier so credential-stuffing across many usernames is still capped.
  const ipLimit = app.rateLimit({
    prefix: 'auth-ip',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.ip,
    message: 'Too many auth attempts from this IP',
  });

  app.post(
    '/register',
    {
      preHandler: [ipLimit],
      schema: {
        // Hidden from the public OpenAPI spec / playground. Auth flow is
        // driven from the dedicated /login page; exposing it on /docs
        // and the dashboard sidebar would let untrusted callers brute
        // force the form, and it leaks our user-management API surface
        // to scrapers. Still reachable directly — `hide: true` is a
        // doc-generation toggle, not a runtime guard.
        hide: true,
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
        // See /register above — hidden for the same reason.
        hide: true,
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

  app.post(
    '/oauth',
    {
      preHandler: [ipLimit],
      schema: {
        hide: true,
        tags: ['auth'],
        summary: 'Exchange a Supabase Auth session for a Rex API JWT',
        description:
          'The browser completes the OAuth dance with Supabase, then posts the resulting access token here. We verify it server-side and issue our own JWT, so the rest of the API keeps a single token format.',
        body: OAuthBody,
        response: { 200: AuthResponse },
      },
    },
    async (req) => {
      // Verified against Supabase rather than decoded locally: only they
      // can say whether the session is still valid and unrevoked.
      const { data, error } = await app.supabase.auth.getUser(req.body.accessToken);
      if (error || !data?.user) {
        throw Unauthorized(
          `oauth: token verification failed: ${error?.message ?? 'no user'}`,
          'Sesi masuk tidak valid atau sudah kedaluwarsa. Coba lagi.',
        );
      }

      const su = data.user;
      const provider = su.app_metadata?.provider;
      if (provider !== 'google' && provider !== 'github') {
        throw Unauthorized(
          `oauth: unsupported provider ${String(provider)}`,
          'Metode masuk ini belum didukung.',
        );
      }

      const email = su.email;
      if (!email) {
        throw Unauthorized(
          'oauth: provider returned no email',
          'Akun ini tidak membagikan alamat email, jadi tidak bisa dipakai masuk.',
        );
      }

      // Absence means unverified: merging into an existing account on an
      // unproven address would let someone claim it.
      const emailVerified =
        su.user_metadata?.email_verified === true ||
        su.user_metadata?.email_confirmed === true ||
        Boolean(su.email_confirmed_at);

      // GitHub carries a real handle; Google has none, so this is often
      // absent and the service falls back to the email local-part.
      const preferredUsername =
        su.user_metadata?.user_name ||
        su.user_metadata?.preferred_username ||
        undefined;

      // Both providers send a human name; Google always, GitHub when the
      // profile has one filled in.
      const displayName =
        su.user_metadata?.full_name ||
        su.user_metadata?.name ||
        undefined;

      const result = await authService(app.supabase).loginWithProvider({
        provider,
        providerId: su.id,
        email,
        emailVerified,
        preferredUsername,
        displayName,
      });

      return { ok: true as const, data: result };
    },
  );

  app.post(
    '/password/forgot',
    {
      preHandler: [ipLimit],
      schema: {
        hide: true,
        tags: ['auth'],
        summary: 'Email a password reset link',
        description: 'Always answers ok, registered or not, so it cannot be used to discover accounts.',
        body: ForgotPasswordBody,
        response: { 200: OkResponse },
      },
    },
    async (req) => {
      await passwordResetService(app.supabase).request(req.body.email, req.log);
      return { ok: true as const };
    },
  );

  app.post(
    '/password/reset/check',
    {
      preHandler: [ipLimit],
      schema: {
        hide: true,
        tags: ['auth'],
        summary: 'Whether a reset token is still usable',
        body: CheckResetBody,
        response: { 200: CheckResetResponse },
      },
    },
    async (req) => {
      const valid = await passwordResetService(app.supabase).check(req.body.token);
      return { ok: true as const, data: { valid } };
    },
  );

  app.post(
    '/password/reset',
    {
      preHandler: [ipLimit],
      schema: {
        hide: true,
        tags: ['auth'],
        summary: 'Set a new password using an emailed reset token',
        body: ResetPasswordBody,
        response: { 200: OkResponse },
      },
    },
    async (req) => {
      await passwordResetService(app.supabase).reset(req.body.token, req.body.password);
      return { ok: true as const };
    },
  );
};

export default authRoutes;
