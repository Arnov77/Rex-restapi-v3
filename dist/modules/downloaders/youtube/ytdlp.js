/**
 * yt-dlp wrapper for YouTube downloads.
 *
 * Downloads video+audio merged into a single mp4 file (temp),
 * then serves it via a local file route. Temp files auto-cleanup after TTL.
 *
 * Requires: yt-dlp + deno + ffmpeg installed on the system.
 * Cookies file in Netscape format at YTDLP_COOKIES_PATH.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../../../config/env.js';
const execFileAsync = promisify(execFile);
const YTDLP_CLIENT_ARGS = ['--extractor-args', 'youtube:player_client=web'];
const TEMP_DIR = resolve(process.cwd(), '.ytdlp-temp');
// Ensure temp dir exists
if (!existsSync(TEMP_DIR))
    mkdirSync(TEMP_DIR, { recursive: true });
// Cleanup old temp files every 10 minutes
setInterval(() => {
    try {
        const now = Date.now();
        const maxAge = 60 * 60 * 1000; // 1 hour
        for (const file of readdirSync(TEMP_DIR)) {
            const filePath = join(TEMP_DIR, file);
            try {
                const stat = statSync(filePath);
                if (now - stat.mtimeMs > maxAge)
                    unlinkSync(filePath);
            }
            catch { /* ignore */ }
        }
    }
    catch { /* ignore */ }
}, 10 * 60 * 1000).unref();
function getCookiesPath() {
    const env = loadEnv();
    const p = resolve(process.cwd(), env.YTDLP_COOKIES_PATH);
    return existsSync(p) ? p : null;
}
/**
 * Get video metadata via yt-dlp -j.
 */
export async function ytdlpGetMeta(url) {
    const cookies = getCookiesPath();
    const args = [
        '--no-warnings',
        '-j',
        '--no-playlist',
        '--skip-download',
        ...YTDLP_CLIENT_ARGS,
        ...(cookies ? ['--cookies', cookies] : []),
        url,
    ];
    const { stdout } = await execFileAsync('yt-dlp', args, {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
    });
    const data = JSON.parse(stdout);
    return {
        title: data.title || 'YouTube Video',
        author: data.uploader || data.channel || '',
        thumbnail: data.thumbnail || null,
        duration: data.duration || null,
    };
}
/**
 * Download video+audio merged into mp4 at given quality.
 * Returns path to temp file.
 */
export async function ytdlpDownloadVideo(url, quality = '720') {
    const cookies = getCookiesPath();
    const id = randomBytes(8).toString('hex');
    const outputPath = join(TEMP_DIR, `${id}.mp4`);
    const args = [
        '--no-warnings',
        '--no-playlist',
        '-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`,
        '--merge-output-format', 'mp4',
        '-o', outputPath,
        ...YTDLP_CLIENT_ARGS,
        ...(cookies ? ['--cookies', cookies] : []),
        url,
    ];
    await execFileAsync('yt-dlp', args, {
        timeout: 120_000, // 2 min for download+merge
        maxBuffer: 10 * 1024 * 1024,
    });
    if (!existsSync(outputPath)) {
        throw new Error(`yt-dlp did not produce output file for ${quality}p`);
    }
    // Get metadata
    const meta = await ytdlpGetMeta(url).catch(() => ({
        title: 'YouTube Video',
        author: '',
        thumbnail: null,
        duration: null,
    }));
    return { ...meta, filePath: outputPath };
}
/**
 * Download audio-only as mp3.
 * Returns path to temp file.
 */
export async function ytdlpDownloadAudio(url) {
    const cookies = getCookiesPath();
    const id = randomBytes(8).toString('hex');
    const outputTemplate = join(TEMP_DIR, `${id}`);
    const args = [
        '--no-warnings',
        '--no-playlist',
        '-f', 'ba/b',
        '-x',
        '--audio-format', 'mp3',
        '-o', `${outputTemplate}.%(ext)s`,
        ...YTDLP_CLIENT_ARGS,
        ...(cookies ? ['--cookies', cookies] : []),
        url,
    ];
    await execFileAsync('yt-dlp', args, {
        timeout: 120_000,
        maxBuffer: 10 * 1024 * 1024,
    });
    // Find the output file (yt-dlp names it with the actual extension)
    const mp3Path = `${outputTemplate}.mp3`;
    if (!existsSync(mp3Path)) {
        throw new Error('yt-dlp did not produce audio output file');
    }
    const meta = await ytdlpGetMeta(url).catch(() => ({
        title: 'YouTube Video',
        author: '',
        thumbnail: null,
        duration: null,
    }));
    return { ...meta, filePath: mp3Path };
}
// Aliases
export const ytdlpGetVideo = ytdlpDownloadVideo;
export const ytdlpGetAudio = ytdlpDownloadAudio;
/** Get the temp directory path (for serving files) */
export function getTempDir() {
    return TEMP_DIR;
}
/** Turn one yt-dlp info entry into proxy-able media items. */
/** True when a format is clearly audio-only (so we never pick it for video). */
function isLikelyAudioOnly(f) {
    if (f.vcodec === 'none' && !!f.acodec && f.acodec !== 'none')
        return true;
    if (/^(m4a|mp3|opus|aac|ogg|weba)$/i.test(f.ext ?? ''))
        return true;
    return false;
}
/** True when a format carries video — by explicit codec, or (when yt-dlp omits
 *  codec info, as it often does for Instagram) by dimensions / a video ext. */
function isLikelyVideo(f) {
    if (typeof f.url !== 'string')
        return false;
    if (isLikelyAudioOnly(f))
        return false;
    if (/^(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.ext ?? ''))
        return false; // reject image formats
    if (f.vcodec && f.vcodec !== 'none')
        return true;
    if (!f.vcodec && (f.height ?? 0) > 0)
        return true;
    if (/^(mp4|mov|webm|mkv)$/i.test(f.ext ?? '') && (f.height ?? 0) > 0)
        return true;
    return false;
}
/** Turn one yt-dlp info entry into proxy-able media items. */
function entryToMedia(entry) {
    const formats = (Array.isArray(entry.formats) ? entry.formats : []).filter((f) => typeof f.url === 'string');
    // Video formats only (never audio-only). Prefer muxed (has audio); else best
    // by resolution — IG/FB single videos are muxed even with blank codec fields.
    const videos = formats.filter(isLikelyVideo);
    if (videos.length) {
        const muxed = videos.filter((f) => f.acodec && f.acodec !== 'none');
        const pool = (muxed.length ? muxed : videos).sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0));
        const out = [];
        const seen = new Set();
        for (const f of pool) {
            const quality = (f.height ?? 0) >= 720 ? 'hd' : 'sd';
            if (seen.has(quality))
                continue;
            seen.add(quality);
            out.push({ type: 'video', url: f.url, quality });
        }
        return out;
    }
    // Photo post → image. Prefer an image-ext format; fall back to entry.url.
    const imgFmt = formats.find((f) => /^(jpe?g|png|webp|heic|gif)$/i.test(f.ext ?? ''));
    if (imgFmt?.url)
        return [{ type: 'image', url: imgFmt.url }];
    const isImageExt = !!entry.ext && /^(jpe?g|png|webp|heic|gif)$/i.test(entry.ext);
    if (typeof entry.url === 'string' && (isImageExt || (entry.vcodec === 'none' && entry.acodec === 'none'))) {
        return [{ type: 'image', url: entry.url }];
    }
    if (typeof entry.url === 'string')
        return [{ type: 'image', url: entry.url }];
    return [];
}
/**
 * Extract metadata + direct media URLs for a post/reel/video without writing
 * anything to disk. Supports single items and carousels (playlist entries).
 */
export async function ytdlpGetInfo(url) {
    const cookies = getCookiesPath();
    const args = [
        '--no-warnings',
        '-J',
        '--playlist-end', '20',
        ...YTDLP_CLIENT_ARGS,
        ...(cookies ? ['--cookies', cookies] : []),
        url,
    ];
    const { stdout } = await execFileAsync('yt-dlp', args, {
        timeout: 45_000,
        maxBuffer: 20 * 1024 * 1024,
    });
    const data = JSON.parse(stdout);
    const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [data];
    const media = [];
    const seenUrls = new Set();
    for (const entry of entries) {
        for (const m of entryToMedia(entry)) {
            if (seenUrls.has(m.url))
                continue;
            seenUrls.add(m.url);
            media.push(m);
        }
    }
    const head = entries[0] ?? data;
    const name = (data.uploader || head.uploader || data.channel || head.channel || '').toString();
    const username = (data.uploader_id || head.uploader_id || '').toString();
    const durationRaw = data.duration ?? head.duration;
    return {
        title: (data.title || head.title || 'Untitled').toString().replace(/\s+/g, ' ').trim().slice(0, 200),
        author: { name, username },
        thumbnail: (data.thumbnail || head.thumbnail || null),
        duration: typeof durationRaw === 'number' ? durationRaw : null,
        media,
    };
}
/**
 * Fetch `sourceUrl` (optionally with custom headers, e.g. a Referer that the
 * TikTok CDN requires), then normalize loudness to a temp mp3 via ffmpeg.
 */
const DEFAULT_AUDIO_FILTER = 'loudnorm=I=-13:TP=-1.5,acompressor=threshold=-20dB:ratio=4:attack=5:release=80:makeup=2,alimiter=level_in=1:level_out=1:limit=0.89';
export async function downloadAndNormalizeAudio(sourceUrl, opts = {}) {
    const id = randomBytes(8).toString('hex');
    const inputPath = join(TEMP_DIR, `${id}.src`);
    const outputPath = join(TEMP_DIR, `${id}.mp3`);
    const filter = opts.filter || loadEnv().AUDIO_LOUDNESS_FILTER || DEFAULT_AUDIO_FILTER;
    const res = await fetch(sourceUrl, { headers: opts.headers, signal: AbortSignal.timeout(30_000) });
    if (!res.ok || !res.body)
        throw new Error(`audio source fetch failed: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0)
        throw new Error('audio source returned empty body');
    writeFileSync(inputPath, buf);
    try {
        await execFileAsync('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', inputPath,
            '-af', filter,
            '-c:a', 'libmp3lame', '-b:a', opts.bitrate ?? '192k',
            outputPath,
        ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
    }
    finally {
        try {
            unlinkSync(inputPath);
        }
        catch { /* ignore */ }
    }
    if (!existsSync(outputPath))
        throw new Error('ffmpeg did not produce normalized audio');
    return { filePath: outputPath };
}
//# sourceMappingURL=ytdlp.js.map