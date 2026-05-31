import fp from 'fastify-plugin';
import { rateLimitRepo } from '@modules/rateLimit/rateLimit.repo.js';
import { TooManyRequests } from '@shared/errors.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Build a per-route rate-limit pre-handler. Backed by Supabase so it
     * is shared across instances and survives restarts.
     *
     * Tier policy (applied automatically based on req.apiKey):
     *  - master tier              → bypass entirely (no counter, no headers)
     *  - user tier (any non-master API key) → max × `userMultiplier` (default 2)
     *  - anon (no API key)        → max as configured
     *
     * Fail-open: if the RPC errors, the request is allowed through with a
     * warning. A login outage is preferable to a global lockout.
     */
    rateLimit: (opts: RateLimitOpts) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export interface RateLimitOpts {
  windowSec: number;
  /** Base max — applied as-is for anon. Multiplied by userMultiplier for authenticated user-tier keys. */
  max: number;
  /** Bucket key. Prefixed with the route's `prefix` for isolation. */
  keyGenerator: (req: FastifyRequest) => string | null;
  prefix: string;
  message?: string;
  /** If returns true, skip rate-limit entirely for this request. */
  skip?: (req: FastifyRequest) => boolean;
  /**
   * Multiplier applied to `max` when the request carries a non-master API key.
   * Default 2 — authenticated users get twice the anon budget.
   */
  userMultiplier?: number;
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
      const userMultiplier = opts.userMultiplier ?? 2;
      return async (req, reply) => {
        if (opts.skip?.(req)) return;

        // Master keys bypass rate-limit entirely. They're issued to operators
        // and trusted services — counting them just creates noise + risk of
        // accidentally rate-limiting our own admin tooling.
        if (req.apiKey?.tier === 'master') return;

        const subKey = opts.keyGenerator(req);
        if (!subKey) return;
        const bucket = `${opts.prefix}:${subKey}`;

        // User-tier keys get a multiplied budget. Anonymous IPs get the base.
        const effectiveMax = req.apiKey ? Math.floor(opts.max * userMultiplier) : opts.max;

        try {
          const result = await repo.hit(bucket, opts.windowSec, effectiveMax);
          reply.header('RateLimit-Limit', String(effectiveMax));
          reply.header('RateLimit-Remaining', String(Math.max(0, effectiveMax - result.count)));
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
