import { z } from 'zod';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { ytdlpDownloadAudio, getTempDir } from './ytdlp.js';
import { shortProxyUrl } from '../../downloaders/_proxy/proxy.token.js';
const Ytmp3Query = z.object({
    url: z.string().url().refine((u) => /youtube\.com|youtu\.be|youtube-nocookie\.com/i.test(u), { message: 'Must be a valid YouTube URL' }),
});
const ytmp3Routes = async (app) => {
    // Main endpoint — returns JSON with short proxy URL
    app.get('/', {
        schema: {
            tags: ['download'],
            summary: 'YouTube to MP3',
            description: 'Extract and convert audio from YouTube video to MP3. Returns metadata + short proxy URL.',
            querystring: Ytmp3Query,
        },
    }, async (req) => {
        const result = await ytdlpDownloadAudio(req.query.url);
        const base = `${req.protocol}://${req.host}`;
        const fileId = basename(result.filePath);
        const internalUrl = `${base}/api/downloader/ytmp3/file/${fileId}`;
        const proxyUrl = shortProxyUrl(base, internalUrl, {
            filename: `${result.title.replace(/[^a-zA-Z0-9 _-]/g, '')}.mp3`,
            contentType: 'audio/mpeg',
        });
        return {
            ok: true,
            data: {
                title: result.title,
                author: result.author,
                url: proxyUrl,
                format: 'mp3',
            },
        };
    });
    // File serving endpoint — streams the temp mp3 (used internally by proxy)
    app.get('/file/:id', { schema: { hide: true } }, async (req, reply) => {
        const { id } = req.params;
        if (!/^[a-f0-9]+\.mp3$/.test(id)) {
            return reply.code(400).send({ ok: false, error: { message: 'Invalid file ID' } });
        }
        const filePath = `${getTempDir()}/${id}`;
        try {
            const stat = statSync(filePath);
            reply
                .type('audio/mpeg')
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
export default ytmp3Routes;
//# sourceMappingURL=ytmp3.routes.js.map