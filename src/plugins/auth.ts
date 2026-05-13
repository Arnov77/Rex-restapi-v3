import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env.js';
import { Unauthorized, Forbidden } from '../shared/errors.js';
import { apiKeysRepo, type ApiKeyRecord } from '../modules/apiKeys/apiKeys.repo.js';
import { hashApiKey, KEY_PREFIX } from '../modules/apiKeys/apiKeys.crypto.js';
import { usersRepo, type PublicUser } from '../modules/auth/users.repo.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** Hard-require a valid JWT. Sets `req.user`. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Hard-require a master API key. Sets `req.apiKey`. */
    requireMaster: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: PublicUser | null;
    apiKey: ApiKeyRecord | null;
  }
}

interface JwtPayload {
  sub: string;
  type: 'access';
}

function extractApiKey(req: FastifyRequest): string | null {
  const direct = req.headers['x-api-key'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(auth);
    if (match && match[1]?.startsWith(KEY_PREFIX)) return match[1];
  }
  return null;
}

function extractJwt(req: FastifyRequest): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  if (!match || !match[1]) return null;
  const token = match[1].trim();
  if (!token || token.startsWith(KEY_PREFIX)) return null; // looks like an API key, skip
  return token;
}

export default fp(
  async (app) => {
    const env = loadEnv();

    // Pre-handler: attach optional API key & user context to every request
    // so downstream code (rate-limit, controllers) can inspect tier without
    // re-parsing headers.
    app.addHook('onRequest', async (req) => {
      req.user = null;
      req.apiKey = null;
    });

    app.addHook('preHandler', async (req) => {
      const supplied = extractApiKey(req);
      if (!supplied) return;
      if (!supplied.startsWith(KEY_PREFIX)) {
        throw Unauthorized('Invalid API key format');
      }
      try {
        const record = await apiKeysRepo(app.supabase).findByHash(hashApiKey(supplied));
        if (record && !record.revoked) {
          req.apiKey = record;
          // fire-and-forget; don't block request on touch.
          void apiKeysRepo(app.supabase).touch(record.id).catch((err) => {
            req.log.warn({ err }, 'failed to touch api key');
          });
        }
      } catch (err) {
        req.log.warn({ err }, 'apiKey lookup failed (treating as anon)');
      }
    });

    app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
      const token = extractJwt(req);
      if (!token) throw Unauthorized('Missing bearer token');
      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      } catch (err) {
        const e = err as Error & { name?: string };
        throw Unauthorized(e.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
      }
      const user = await usersRepo(app.supabase).findById(payload.sub);
      if (!user) throw Unauthorized('User no longer exists');
      req.user = usersRepo(app.supabase).publicView(user);
    });

    app.decorate('requireMaster', async (req: FastifyRequest, _reply: FastifyReply) => {
      if (req.apiKey?.tier !== 'master') {
        throw Forbidden('Master API key required');
      }
    });
  },
  { name: 'auth', dependencies: ['supabase'] },
);
