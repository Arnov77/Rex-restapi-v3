import fp from 'fastify-plugin';
import { rateLimitRepo } from '../modules/rateLimit/rateLimit.repo.js';
import { TooManyRequests } from '../shared/errors.js';
export default fp(async (app) => {
    const repo = rateLimitRepo(app.supabase);
    // Periodic GC of expired windows. Once an hour is plenty.
    const gcInterval = setInterval(() => {
        repo.gc('1 day').catch((err) => app.log.warn({ err }, 'rate-limit gc failed'));
    }, 60 * 60 * 1000);
    app.addHook('onClose', async () => clearInterval(gcInterval));
    app.decorate('rateLimit', (opts) => {
        const userMultiplier = opts.userMultiplier ?? 2;
        return async (req, reply) => {
            if (opts.skip?.(req))
                return;
            // Master keys bypass rate-limit entirely. They're issued to operators
            // and trusted services — counting them just creates noise + risk of
            // accidentally rate-limiting our own admin tooling.
            if (req.apiKey?.tier === 'master')
                return;
            const subKey = opts.keyGenerator(req);
            if (!subKey)
                return;
            const bucket = `${opts.prefix}:${subKey}`;
            // User-tier keys get a multiplied budget. Anonymous IPs get the base.
            const effectiveMax = req.apiKey ? Math.floor(opts.max * userMultiplier) : opts.max;
            try {
                const result = await repo.hit(bucket, opts.windowSec, effectiveMax);
                reply.header('RateLimit-Limit', String(effectiveMax));
                reply.header('RateLimit-Remaining', String(Math.max(0, effectiveMax - result.count)));
                reply.header('RateLimit-Reset', String(Math.max(0, Math.ceil((result.resetAt.getTime() - Date.now()) / 1000))));
                if (!result.allowed) {
                    throw TooManyRequests(opts.message ?? 'Too many requests');
                }
            }
            catch (err) {
                if (err && typeof err === 'object' && 'statusCode' in err)
                    throw err;
                req.log.warn({ err, bucket }, 'rate-limit RPC failed (fail-open)');
            }
        };
    });
}, { name: 'rate-limit', dependencies: ['supabase'] });
//# sourceMappingURL=rateLimit.js.map