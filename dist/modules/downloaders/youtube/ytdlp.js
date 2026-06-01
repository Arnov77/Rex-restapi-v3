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
import { existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { loadEnv } from '../../../config/env.js';
const execFileAsync = promisify(execFile);
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
//# sourceMappingURL=ytdlp.js.map