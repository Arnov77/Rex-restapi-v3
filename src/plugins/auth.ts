import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import { loadEnv } from '../config/env.js';
import { Unauthorized, Forbidden, AppError } from '../shared/errors.js';
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

    /**
     * Single global pre-handler that decides "who is this caller?" so
     * the rate-limit and quota plugins can bucket correctly. Three
     * inputs, in priority order:
     *
     *   1. X-API-Key header (or `Authorization: Bearer rex_...`)
     *      → the canonical bot path. Hard 401 on a malformed key, or
     *        on a syntactically valid key whose hash doesn't match a
     *        live, non-revoked row. **This is new behaviour.** Until
     *        today we silently degraded those cases to anon, which
     *        produced ghost reports of "I'm logged in but the headers
     *        say 100/day" — exactly the bug being fixed here. Failing
     *        loudly forces stale clients to clear their cached key
     *        and re-auth.
     *
     *   2. Authorization: Bearer <jwt>  (no key supplied)
     *      → the dashboard path. Resolve the user, look up the key
     *        row that user.api_key_id points at, and attach it to
     *        req.apiKey. Now rate-limit/quota see the *correct* key
     *        record (with its dailyLimit) even though the request
     *        never carried an X-API-Key header. This is what makes a
     *        fresh-Incognito login start counting against the user's
     *        bucket immediately, instead of silently falling back to
     *        the anon-IP bucket.
     *
     *        A bad/expired JWT here is non-fatal — the request just
     *        proceeds as anon. Routes that genuinely need the JWT
     *        (everything in /api/me/*) are gated by app.authenticate
     *        which throws 401 explicitly.
     *
     *   3. Neither → req.apiKey + req.user stay null (true anon).
     *
     * The two paths are mutually exclusive: extractApiKey returns
     * non-null only when the request looks key-shaped, and extractJwt
     * skips bearer tokens that look key-shaped. So a request can match
     * branch 1 OR branch 2, never both.
     */
    app.addHook('preHandler', async (req) => {
      // ── Branch 1: explicit API key ──────────────────────────────
      const supplied = extractApiKey(req);
      if (supplied) {
        if (!supplied.startsWith(KEY_PREFIX)) {
          throw Unauthorized('Invalid API key format');
        }
        let record: ApiKeyRecord | null = null;
        try {
          record = await apiKeysRepo(app.supabase).findByHash(hashApiKey(supplied));
        } catch (err) {
          // Genuine DB / network error. Don't leak the underlying
          // message; treat as service degradation but still 503 so
          // the client doesn't silently get the wrong tier of bucket.
          req.log.warn({ err }, 'apiKey lookup failed');
          throw new AppError(503, 'AUTH_LOOKUP_FAILED', 'Could not validate API key, try again');
        }
        if (!record) {
          // Hash didn't match any row. Almost always a stale client
          // key (regenerate on device A → device B still ships old).
          throw new AppError(401, 'INVALID_API_KEY', 'API key not recognised');
        }
        if (record.revoked) {
          throw new AppError(401, 'REVOKED_API_KEY', 'API key has been revoked');
        }
        req.apiKey = record;
        // fire-and-forget; don't block request on touch.
        void apiKeysRepo(app.supabase).touch(record.id).catch((err) => {
          req.log.warn({ err }, 'failed to touch api key');
        });
        return;
      }

      // ── Branch 2: JWT only ──────────────────────────────────────
      const token = extractJwt(req);
      if (!token) return;

      let payload: JwtPayload;
      try {
        payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      } catch {
        // Bad/expired JWT here is non-fatal. Auth-optional routes
        // (screenshot/brat/quote) stay anon-callable; auth-required
        // routes are gated by app.authenticate which re-runs verify
        // and surfaces the precise error.
        return;
      }

      let userRow;
      try {
        userRow = await usersRepo(app.supabase).findById(payload.sub);
      } catch (err) {
        req.log.warn({ err }, 'jwt user lookup failed (treating as anon)');
        return;
      }
      if (!userRow) return;
      req.user = usersRepo(app.supabase).publicView(userRow);

      // Cross-link to the user's primary API key row so rate-limit
      // and quota see a consistent identity. If the user's apiKeyId
      // is null (legacy row, never registered through the standard
      // flow) we leave req.apiKey null — they fall through to anon
      // bucketing for now, and the dashboard's "regenerate to mint
      // a key" action remains the recovery path.
      if (!userRow.apiKeyId) return;
      try {
        const keyRow = await apiKeysRepo(app.supabase).findById(userRow.apiKeyId);
        if (keyRow && !keyRow.revoked) {
          req.apiKey = keyRow;
        }
      } catch (err) {
        req.log.warn({ err }, 'jwt → key cross-link failed (treating as anon)');
      }
    });

    /**
     * Routes that hard-require a JWT mount this. After today's
     * pre-handler change, req.user is populated for any valid JWT
     * before this fires, so the happy path is a no-op assertion.
     * The slow path (re-running jwt.verify) only triggers when the
     * global preHandler swallowed a verify error and the route now
     * needs the precise reason ("Token expired" vs "Invalid token")
     * — preserving the existing test contract.
     */
    app.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
      if (req.user) return;
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
