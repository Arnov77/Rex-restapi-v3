import { z } from 'zod';
import { statSync, createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { shortProxyUrl } from '../../downloaders/_proxy/proxy.token.js';
import { downloadAndNormalizeAudio, getTempDir } from '../youtube/ytdlp.js';
import { AppError } from '../../../shared/errors.js';
import { loadEnv } from '../../../config/env.js';
const Ttmp3Query = z.object({
    url: z.string().url().refine((u) => /tiktok\.com|vm\.tiktok\.com|vt\.tiktok\.com/i.test(u), { message: 'Must be a valid TikTok URL' }),
});
const Ttmp3Response = z.object({
    ok: z.literal(true),
    data: z.object({
        title: z.string(),
        url: z.string(),
        format: z.string(),
    }),
});
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
/** Resolve a short TikTok URL (vt./vm.tiktok.com) to its canonical URL. */
async function resolveShortUrl(url) {
    if (!/vm\.tiktok\.com|vt\.tiktok\.com/i.test(url))
        return url;
    try {
        const res = await fetch(url, {
            method: 'HEAD',
            redirect: 'follow',
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(8_000),
        });
        return res.url || url;
    }
    catch {
        return url;
    }
}
/** Resolve a raw audio source URL + title from cobalt, then tikwm. */
async function resolveAudioSource(resolvedUrl, env, errors) {
    // Method 1: cobalt (audio mode → direct CDN mp3 URL)
    try {
        const res = await fetch(env.COBALT_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                url: resolvedUrl,
                downloadMode: 'audio',
                audioFormat: 'mp3',
                audioBitrate: '128',
                filenameStyle: 'basic',
            }),
            signal: AbortSignal.timeout(15_000),
        });
        const raw = await res.text().catch(() => '');
        let json = {};
        try {
            json = raw ? JSON.parse(raw) : {};
        }
        catch { /* non-JSON */ }
        if (!res.ok || json.status === 'error') {
            errors.push(`cobalt ${res.status}: ${json?.error?.code || raw.slice(0, 120)}`);
        }
        else if (json.url) {
            const title = (json.filename || 'tiktok_audio').replace(/\.\w+$/, '');
            return { audioUrl: json.url, title };
        }
        else {
            errors.push('cobalt: no audio URL returned');
        }
    }
    catch (err) {
        errors.push(`cobalt: ${err.message}`);
    }
    // Method 2: tikwm fallback (music_info.play / music)
    try {
        const res = await fetch('https://www.tikwm.com/api/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
            body: `url=${encodeURIComponent(resolvedUrl)}&count=12&cursor=0&web=1&hd=1`,
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok)
            throw new Error(`tikwm returned ${res.status}`);
        const json = (await res.json());
        if (json.code !== 0 || !json.data)
            throw new Error(json.msg || 'no data returned');
        const d = json.data;
        const audioUrl = d.music_info?.play || d.music;
        if (!audioUrl)
            throw new Error('no audio URL in response');
        const title = (d.title || 'TikTok Audio').replace(/[\r]+/g, ' ').trim();
        return { audioUrl, title };
    }
    catch (err) {
        errors.push(`tikwm: ${err.message}`);
    }
    return null;
}
const ttmp3Routes = async (app) => {
    app.get('/', {
        schema: {
            tags: ['download'],
            summary: 'TikTok to MP3',
            description: 'Extract audio from TikTok video as MP3 (loudness-normalized). Returns a streamable proxy URL.',
            querystring: Ttmp3Query,
            response: { 200: Ttmp3Response },
        },
    }, async (req) => {
        const env = loadEnv();
        const resolvedUrl = await resolveShortUrl(req.query.url);
        const errors = [];
        const source = await resolveAudioSource(resolvedUrl, env, errors);
        if (!source) {
            throw new AppError(502, 'TIKTOK_AUDIO_FAILED', `TikTok audio extraction failed. Tried: ${errors.join('; ')}`);
        }
        // TikTok audio is often mastered very quietly (~-26 dB). Download and
        // run it through ffmpeg loudnorm so the MP3 plays at a normal volume.
        let filePath;
        try {
            const normalized = await downloadAndNormalizeAudio(source.audioUrl, {
                headers: { 'User-Agent': UA, Referer: 'https://www.tiktok.com/' },
            });
            filePath = normalized.filePath;
        }
        catch (err) {
            req.log.warn({ err }, 'ttmp3 normalize failed');
            throw new AppError(502, 'TIKTOK_AUDIO_FAILED', `Could not process TikTok audio: ${err.message}`);
        }
        const cleanTitle = source.title.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 80) || 'tiktok_audio';
        const base = `${req.protocol}://${req.host}`;
        const fileId = basename(filePath);
        const internalUrl = `${base}/api/downloader/ttmp3/file/${fileId}`;
        const proxyedUrl = shortProxyUrl(base, internalUrl, {
            filename: `${cleanTitle}.mp3`,
            contentType: 'audio/mpeg',
        });
        return { ok: true, data: { title: source.title, url: proxyedUrl, format: 'mp3' } };
    });
    // File serving endpoint — streams the normalized temp mp3 (used by proxy).
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
export default ttmp3Routes;
//# sourceMappingURL=ttmp3.routes.js.map