import { miqService } from './miq.service.js';
import { MiqQuery } from './miq.schemas.js';
const miqRoutes = async (app) => {
    const quota = app.quota({ message: 'Daily MIQ quota exceeded' });
    const limit = app.rateLimit({
        prefix: 'miq',
        windowSec: 60,
        max: 5,
        keyGenerator: (req) => req.apiKey?.id ?? req.ip,
        message: 'Too many MIQ requests',
    });
    app.get('/', {
        preHandler: [quota, limit],
        schema: {
            tags: ['maker'],
            summary: 'Render a Make It Quote card. Params: text, name, username, image, orientation, image_filter, format, quality',
            querystring: MiqQuery,
        },
    }, async (req, reply) => {
        const ac = new AbortController();
        req.raw.once('close', () => ac.abort());
        const before = miqService.cache.hits;
        const result = await miqService.generate(req.query, { signal: ac.signal });
        const cacheHit = miqService.cache.hits > before;
        const ext = result.format === 'jpeg' ? 'jpg' : result.format;
        return reply
            .header('content-type', result.mimeType)
            .header('content-length', String(result.buffer.length))
            .header('content-disposition', `inline; filename="miq.${ext}"`)
            .header('cache-control', 'public, max-age=1800')
            .header('x-cache', cacheHit ? 'HIT' : 'MISS')
            .send(result.buffer);
    });
};
export default miqRoutes;
//# sourceMappingURL=miq.routes.js.map