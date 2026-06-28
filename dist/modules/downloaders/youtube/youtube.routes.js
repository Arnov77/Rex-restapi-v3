import { z } from 'zod';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { downloadYoutube } from './youtube.service.js';
import { getTempDir } from './ytdlp.js';
import { shortProxyUrl } from '../../downloaders/_proxy/proxy.token.js';
const YoutubeQuery = z.object({
    url: z.string().url().refine((u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u), { message: 'Must be a valid YouTube URL' }),
    quality: z.enum(['1080', '720', '480', '360']).default('720').optional(),
});
const youtubeRoutes = async (app) => {
    // Main endpoint — returns JSON with short proxy URL
    app.get('/', {
        schema: {
            tags: ['download'],
            summary: 'Download YouTube video (merged mp4 with audio)',
            description: 'Downloads and merges video+audio into a single streamable mp4. Returns metadata + short proxy URL.',
            querystring: YoutubeQuery,
        },
    }, async (req) => {
        const quality = req.query.quality || '720';
        const result = await downloadYoutube(req.query.url, quality);
        const media = result.media[0];
        const base = `${req.protocol}://${req.host}`;
        const fileId = basename(media.filePath);
        const internalUrl = `${base}/api/downloader/youtube/file/${fileId}`;
        const proxyUrl = shortProxyUrl(base, internalUrl, {
            filename: `${result.title.replace(/[^a-zA-Z0-9 _-]/g, '')} (${media.quality}).mp4`,
            contentType: 'video/mp4',
        });
        return {
            ok: true,
            data: {
                title: result.title,
                author: result.author,
                thumbnail: result.thumbnail,
                duration: result.duration,
                media: [{ type: 'video', url: proxyUrl, quality: media.quality }],
            },
        };
    });
    // File serving endpoint — streams the temp mp4 (used internally by proxy)
    app.get('/file/:id', { schema: { hide: true } }, async (req, reply) => {
        const { id } = req.params;
        if (!/^[a-f0-9]+\.mp4$/.test(id)) {
            return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
        }
        const filePath = `${getTempDir()}/${id}`;
        try {
            const stat = statSync(filePath);
            reply
                .type('video/mp4')
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
export default youtubeRoutes;
//# sourceMappingURL=youtube.routes.js.map