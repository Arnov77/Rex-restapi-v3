import { z } from 'zod';
import { getBrowser } from '../../shared/browser/browserManager.js';
/**
 * Health probes.
 *
 * `/health` — liveness: process is up. Cheap, never touches dependencies.
 *             Container orchestrators use this for restart decisions.
 *
 * `/ready`  — readiness: dependencies are reachable. Returns 503 when any
 *             critical dep is down so load balancers can drain traffic.
 *             We probe two: Supabase (data plane) and Chromium (render
 *             plane — screenshot/brat/quote all rely on the singleton).
 *             Each component is reported individually so operators can
 *             tell *which* dep failed without grepping logs.
 */
const ReadyResponse = z.object({
    ok: z.boolean(),
    db: z.enum(['up', 'down']),
    browser: z.enum(['up', 'down']),
});
const healthRoutes = async (app) => {
    app.get('/health', {
        schema: {
            tags: ['health'],
            summary: 'Liveness probe',
            response: {
                200: z.object({ ok: z.literal(true), uptime: z.number(), version: z.string() }),
            },
        },
    }, async () => ({ ok: true, uptime: process.uptime(), version: '3.0.0' }));
    app.get('/ready', {
        schema: {
            tags: ['health'],
            summary: 'Readiness probe (checks DB and headless browser)',
            response: { 200: ReadyResponse, 503: ReadyResponse },
        },
    }, async (_req, reply) => {
        // Probe both deps in parallel. We don't short-circuit on the first
        // failure — operators want a complete picture.
        const [dbResult, browserResult] = await Promise.allSettled([
            app.supabase.from('users').select('id').limit(1),
            // getBrowser() either returns the cached singleton (no-op) or
            // launches Chromium. If launch fails it throws → 'down'.
            // We don't open a page — just confirming the browser process is
            // reachable is enough for readiness.
            getBrowser().then((browser) => browser.isConnected()),
        ]);
        const dbUp = dbResult.status === 'fulfilled' && dbResult.value.error == null;
        const browserUp = browserResult.status === 'fulfilled' && browserResult.value === true;
        const body = {
            ok: dbUp && browserUp,
            db: (dbUp ? 'up' : 'down'),
            browser: (browserUp ? 'up' : 'down'),
        };
        return body.ok ? body : reply.code(503).send(body);
    });
};
export default healthRoutes;
//# sourceMappingURL=health.routes.js.map