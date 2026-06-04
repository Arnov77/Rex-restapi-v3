/**
 * Signed-URL proxy — streams media from a source URL to the client.
 *
 * Token contains: { url, exp, filename?, contentType? }
 * Signed with HMAC-SHA256 using JWT_SECRET. Verified before streaming.
 *
 * This prevents the endpoint from being an open relay while letting
 * bot users download media through our domain (faster, more reliable
 * than random CDN URLs that expire quickly).
 *
 * Streaming + SSRF/size hardening lives in `streamProxy.ts`.
 */
import { z } from 'zod';
import { verifyProxyToken } from './proxy.token.js';
import { streamProxyResponse } from './streamProxy.js';
const ProxyQuery = z.object({
    t: z.string().min(1, 'Missing token'),
});
const proxyRoutes = async (app) => {
    app.get('/', {
        schema: {
            hide: true,
            tags: ['download'],
            summary: 'Stream media via signed proxy token',
            querystring: ProxyQuery,
        },
    }, async (req, reply) => {
        const payload = verifyProxyToken(req.query.t);
        if (!payload) {
            return reply.code(403).send({ ok: false, error: { message: 'Invalid or expired token' } });
        }
        return streamProxyResponse(req, reply, payload, 'proxy');
    });
};
export default proxyRoutes;
//# sourceMappingURL=proxy.routes.js.map