import fp from 'fastify-plugin';
import { quotaRepo, todayUtc } from '../modules/quota/quota.repo.js';
import { loadEnv } from '../config/env.js';
import { TooManyRequests } from '../shared/errors.js';
function counterFor(req, prefix) {
    const env = loadEnv();
    const apiKey = req.apiKey;
    const ns = prefix ? `${prefix}:` : '';
    if (!apiKey) {
        // Anonymous → keyed by client IP.
        return { key: `${ns}ip:${req.ip}`, limit: env.ANON_DAILY_QUOTA };
    }
    if (apiKey.tier === 'master') {
        // Master tier never counted — return null so plugin short-circuits.
        return null;
    }
    // dailyLimit === null means "admin explicitly granted unlimited" → bypass.
    if (apiKey.dailyLimit === null) {
        return null;
    }
    // User tier with an explicit numeric limit.
    return { key: `${ns}key:${apiKey.id}`, limit: apiKey.dailyLimit };
}
/**
 * Seconds until the next UTC midnight — used as the X-Daily-Reset header
 * so clients know when their counter resets. Aligned with the bucket_date
 * boundary in quota.repo.ts.
 */
function secondsUntilUtcMidnight(now = new Date()) {
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    return Math.max(0, Math.ceil((next.getTime() - now.getTime()) / 1000));
}
export default fp(async (app) => {
    const repo = quotaRepo(app.supabase);
    app.decorate('quota', (opts = {}) => {
        const prefix = opts.prefix ?? '';
        return async (req, reply) => {
            if (opts.skip?.(req))
                return;
            const target = counterFor(req, prefix);
            if (!target)
                return; // master tier → bypass entirely
            try {
                const result = await repo.increment(target.key, target.limit, todayUtc());
                // Headers: X-Daily-* mirror the RateLimit-* convention but on a
                // separate axis (per-day, vs per-window). Clients can show both.
                reply.header('X-Daily-Limit', String(target.limit));
                reply.header('X-Daily-Used', String(result.used));
                reply.header('X-Daily-Remaining', String(Math.max(0, target.limit - result.used)));
                reply.header('X-Daily-Reset', String(secondsUntilUtcMidnight()));
                if (!result.allowed) {
                    throw TooManyRequests(opts.message ?? 'Daily quota exceeded');
                }
            }
            catch (err) {
                // Re-throw structured errors (TooManyRequests above, or anything
                // else with statusCode). Only swallow real DB failures.
                if (err && typeof err === 'object' && 'statusCode' in err)
                    throw err;
                req.log.warn({ err, counter: target.key }, 'quota RPC failed (fail-open)');
            }
        };
    });
}, { name: 'quota', dependencies: ['supabase', 'auth'] });
//# sourceMappingURL=quota.js.map