import fp from 'fastify-plugin';
import { rateLimitRepo } from '../modules/rateLimit/rateLimit.repo.js';
import { TooManyRequests } from '../shared/errors.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Build a per-route rate-limit pre-handler. Backed by Supabase so it
     * is shared across instances and survives restarts.
     *
     * Fail-open: if the RPC errors, the request is allowed through with a
     * warning. A login outage is preferable to a global lockout.
     */
    rateLimit: (opts: RateLimitOpts) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface RateLimitOpts {
  windowSec: number;
  max: number;
  /** Bucket key. Prefixed with the route's `prefix` for isolation. */
  keyGenerator: (req: FastifyRequest) => string | null;
  prefix: string;
  message?: string;
  /** If returns true, skip rate-limit entirely for this request. */
  skip?: (req: FastifyRequest) => boolean;
}

export default fp(
  async (app) => {
    const repo = rateLimitRepo(app.supabase);

    // Periodic GC of expired windows. Once an hour is plenty.
    const gcInterval = setInterval(
      () => {
        repo.gc('1 day').catch((err) => app.log.warn({ err }, 'rate-limit gc failed'));
      },
      60 * 60 * 1000,
    );
    app.addHook('onClose', async () => clearInterval(gcInterval));

    app.decorate('rateLimit', (opts: RateLimitOpts) => {
      return async (req, reply) => {
        if (opts.skip?.(req)) return;
        const subKey = opts.keyGenerator(req);
        if (!subKey) return;
        const bucket = `${opts.prefix}:${subKey}`;
        try {
          const result = await repo.hit(bucket, opts.windowSec, opts.max);
          reply.header('RateLimit-Limit', String(opts.max));
          reply.header('RateLimit-Remaining', String(Math.max(0, opts.max - result.count)));
          reply.header(
            'RateLimit-Reset',
            String(Math.max(0, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))),
          );
          if (!result.allowed) {
            throw TooManyRequests(opts.message ?? 'Too many requests');
          }
        } catch (err) {
          if (err && typeof err === 'object' && 'statusCode' in err) throw err;
          req.log.warn({ err, bucket }, 'rate-limit RPC failed (fail-open)');
        }
      };
    });
  },
  { name: 'rate-limit', dependencies: ['supabase'] },
);
