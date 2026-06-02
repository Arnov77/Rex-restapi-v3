import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { vcService } from './vc.service.js';
import { VcQuery } from './vc.schemas.js';
import { shortProxyUrl } from '../../downloaders/_proxy/proxy.token.js';
const vcRoutes = async (app) => {
    const quota = app.quota({ message: 'Daily VC quota exceeded' });
    const limit = app.rateLimit({
        prefix: 'vc',
        windowSec: 60,
        max: 5,
        keyGenerator: (req) => req.apiKey?.id ?? req.ip,
        message: 'Too many VC requests',
    });
    // Main endpoint — proses audio, return JSON + short proxy URL
    app.get('/', {
        preHandler: [quota, limit],
        schema: {
            tags: ['maker'],
            summary: 'Apply voice/audio effects. Returns JSON with short proxy URL.',
            querystring: VcQuery,
        },
    }, async (req) => {
        const ac = new AbortController();
        req.raw.once('close', () => ac.abort());
        const result = await vcService.generate(req.query, { signal: ac.signal });
        const base = `${req.protocol}://${req.host}`;
        const fileId = basename(result.filePath);
        const internalUrl = `${base}/api/vc/file/${fileId}`;
        const url = shortProxyUrl(base, internalUrl, {
            filename: `vc-${req.query.effect}.${result.format}`,
            contentType: result.mimeType,
        });
        return {
            ok: true,
            data: {
                effect: req.query.effect,
                format: result.format,
                url,
            },
        };
    });
    // File serving endpoint — stream temp file (dipakai internal oleh proxy)
    app.get('/file/:id', { schema: { hide: true } }, async (req, reply) => {
        const { id } = req.params;
        // Validasi format id: hex + ext
        if (!/^(in-)?[a-f0-9]+\.(mp3|ogg|wav)$/.test(id)) {
            return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
        }
        const filePath = `${vcService.getTempDir()}/${id}`;
        try {
            const stat = statSync(filePath);
            const mimeMap = {
                mp3: 'audio/mpeg',
                ogg: 'audio/ogg',
                wav: 'audio/wav',
            };
            const ext = id.split('.').pop() ?? 'mp3';
            reply
                .type(mimeMap[ext] ?? 'audio/mpeg')
                .header('content-length', String(stat.size))
                .header('content-disposition', `inline; filename="${id}"`)
                .header('cache-control', 'private, max-age=3600');
            return reply.send(createReadStream(filePath));
        }
        catch {
            return reply.code(404).send({ ok: false, error: { message: 'File expired or not found' } });
        }
    });
};
export default vcRoutes;
//# sourceMappingURL=vc.routes.js.map