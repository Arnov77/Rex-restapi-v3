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

const YTDLP_CLIENT_ARGS: string[] = [];
export const YTDLP_CLIENT_ARGS_FALLBACK: string[] = [];

/** Optional upstream proxy for yt-dlp (e.g. http://user:pass@ip:port). */
export function getProxyArgs(): string[] {
  const env = loadEnv();
  return env.YTDLP_PROXY_URL ? ['--proxy', env.YTDLP_PROXY_URL] : [];
}

export interface YtdlpResult {
  title: string;
  author: string;
  thumbnail: string | null;
  duration: number | null;
  filePath: string;
  /** Actual video height delivered — may be lower than requested. */
  height?: number | null;
}

const TEMP_DIR = resolve(process.cwd(), '.ytdlp-temp');

// Ensure temp dir exists
if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

// Cleanup old temp files every 10 minutes
setInterval(() => {
  try {
    const now = Date.now();
    const maxAge = 60 * 60 * 1000; // 1 hour
    for (const file of readdirSync(TEMP_DIR)) {
      const filePath = join(TEMP_DIR, file);
      try {
        const stat = statSync(filePath);
        if (now - stat.mtimeMs > maxAge) unlinkSync(filePath);
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}, 10 * 60 * 1000).unref();

function getCookiesPath(): string | null {
  const env = loadEnv();
  const p = resolve(process.cwd(), env.YTDLP_COOKIES_PATH);
  return existsSync(p) ? p : null;
}

/**
 * Get video metadata via yt-dlp -j.
 */
export async function ytdlpGetMeta(url: string): Promise<{ title: string; author: string; thumbnail: string | null; duration: number | null }> {
  const cookies = getCookiesPath();
  const proxyArgs = getProxyArgs();

  const baseArgs = ['--no-warnings', '-j', '--no-playlist', '--skip-download'];

  const directArgs = [
    ...baseArgs,
    ...YTDLP_CLIENT_ARGS,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', directArgs, { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 }));
  } catch (err) {
    if (!proxyArgs.length) throw err;
    const proxiedArgs = [
      ...baseArgs,
      ...YTDLP_CLIENT_ARGS_FALLBACK,
      ...proxyArgs,
      ...(cookies ? ['--cookies', cookies] : []),
      url,
    ];
    ({ stdout } = await execFileAsync('yt-dlp', proxiedArgs, { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }));
  }

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
export async function ytdlpDownloadVideo(url: string, quality: string = '720'): Promise<YtdlpResult> {
  const cookies = getCookiesPath();
  const id = randomBytes(8).toString('hex');
  const outputPath = join(TEMP_DIR, `${id}.mp4`);
  const proxyArgs = getProxyArgs();

  // Same two wins as the audio path: metadata comes from the download call via
  // --print-json, and the slow upstream proxy is demoted to a fallback.
  // Trailing `/b` lets it fall back to muxed format 18 when YouTube exposes no
  // adaptive streams (common without a PO token).
  const baseArgs = [
    '--no-warnings',
    '--no-playlist',
    '--print-json',
    '-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]/18/b`,
    '--merge-output-format', 'mp4',
    '-o', outputPath,
  ];

  const directArgs = [
    ...baseArgs,
    ...YTDLP_CLIENT_ARGS,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', directArgs, {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  } catch (err) {
    if (!proxyArgs.length) throw err;
    const proxiedArgs = [
      ...baseArgs,
      ...YTDLP_CLIENT_ARGS_FALLBACK,
      ...proxyArgs,
      ...(cookies ? ['--cookies', cookies] : []),
      url,
    ];
    ({ stdout } = await execFileAsync('yt-dlp', proxiedArgs, {
      timeout: 240_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  }

  if (!existsSync(outputPath)) {
    throw new Error(`yt-dlp did not produce output file for ${quality}p`);
  }

  let meta = { title: 'YouTube Video', author: '', thumbnail: null as string | null, duration: null as number | null };
  let actualHeight: number | null = null;
  try {
    const line = stdout.trim().split('\n').find((l) => l.startsWith('{'));
    if (line) {
      const d = JSON.parse(line);
      meta = {
        title: d.title || 'YouTube Video',
        author: d.uploader || d.channel || '',
        thumbnail: d.thumbnail || null,
        duration: typeof d.duration === 'number' ? d.duration : null,
      };
      // YouTube frequently exposes only muxed format 18 (360p) without a PO
      // token, so what we actually got can be lower than what was requested.
      // Report the real height instead of silently implying the asked-for one.
      actualHeight = typeof d.height === 'number' ? d.height : null;
    }
  } catch { /* keep defaults */ }

  return { ...meta, filePath: outputPath, height: actualHeight };
}

/**
 * Download audio-only as mp3.
 * Returns path to temp file.
 */
export async function ytdlpDownloadAudio(url: string): Promise<YtdlpResult> {
  const cookies = getCookiesPath();
  const id = randomBytes(8).toString('hex');
  const outputTemplate = join(TEMP_DIR, `${id}`);
  const proxyArgs = getProxyArgs();

  // `--print-json` gives us metadata from the SAME call that downloads, so we
  // no longer pay for a second full extraction just to read the title.
  // `18/ba/b` first: YouTube commonly exposes only muxed format 18 without a
  // PO token, and asking for `ba` alone then fails outright.
  const baseArgs = [
    '--no-warnings',
    '--no-playlist',
    '--print-json',
    '-f', '18/ba/b',
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '192K',
    '-o', `${outputTemplate}.%(ext)s`,
  ];

  // Direct first — the upstream proxy resolves in minutes rather than seconds,
  // so it is only worth paying for when the direct attempt actually fails.
  const directArgs = [
    ...baseArgs,
    ...YTDLP_CLIENT_ARGS,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', directArgs, {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  } catch (err) {
    if (!proxyArgs.length) throw err;
    const proxiedArgs = [
      ...baseArgs,
      ...YTDLP_CLIENT_ARGS_FALLBACK,
      ...proxyArgs,
      ...(cookies ? ['--cookies', cookies] : []),
      url,
    ];
    ({ stdout } = await execFileAsync('yt-dlp', proxiedArgs, {
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  }

  const mp3Path = `${outputTemplate}.mp3`;
  if (!existsSync(mp3Path)) {
    throw new Error('yt-dlp did not produce audio output file');
  }

  // --print-json emits one JSON object per item; for ytsearch that is the hit.
  let meta = { title: 'YouTube Video', author: '', thumbnail: null as string | null, duration: null as number | null };
  try {
    const line = stdout.trim().split('\n').find((l) => l.startsWith('{'));
    if (line) {
      const d = JSON.parse(line);
      meta = {
        title: d.title || 'YouTube Video',
        author: d.uploader || d.channel || '',
        thumbnail: d.thumbnail || null,
        duration: typeof d.duration === 'number' ? d.duration : null,
      };
    }
  } catch { /* keep defaults */ }

  return { ...meta, filePath: mp3Path };
}

// Aliases
export const ytdlpGetVideo = ytdlpDownloadVideo;
export const ytdlpGetAudio = ytdlpDownloadAudio;

/** Get the temp directory path (for serving files) */
export function getTempDir(): string {
  return TEMP_DIR;
}

// ─── Light extractor: metadata + direct media URL (no temp file) ─────────────
//
// Used by the Instagram/Facebook downloaders. A single `yt-dlp -J` call yields
// both rich metadata AND direct progressive media URLs (audio+video in one
// file), which the signed proxy can stream without downloading to disk. Falls
// back gracefully for photo posts and carousels (playlist entries).

export interface YtdlpMediaItem {
  type: 'video' | 'image' | 'audio';
  url: string;
  quality?: string;
}

export interface YtdlpInfo {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: YtdlpMediaItem[];
}

interface YtdlpFormat {
  url?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  tbr?: number;
  ext?: string;
}

interface YtdlpEntry {
  title?: string;
  uploader?: string;
  uploader_id?: string;
  channel?: string;
  thumbnail?: string;
  duration?: number;
  ext?: string;
  url?: string;
  vcodec?: string;
  acodec?: string;
  formats?: YtdlpFormat[];
}

/** Turn one yt-dlp info entry into proxy-able media items. */
/** True when a format is clearly audio-only (so we never pick it for video). */
function isLikelyAudioOnly(f: YtdlpFormat): boolean {
  if (f.vcodec === 'none' && !!f.acodec && f.acodec !== 'none') return true;
  if (/^(m4a|mp3|opus|aac|ogg|weba)$/i.test(f.ext ?? '')) return true;
  return false;
}

/** True when a format carries video — by explicit codec, or (when yt-dlp omits
 *  codec info, as it often does for Instagram) by dimensions / a video ext. */
function isLikelyVideo(f: YtdlpFormat): boolean {
  if (typeof f.url !== 'string') return false;
  if (isLikelyAudioOnly(f)) return false;
  if (/^(jpe?g|png|webp|heic|gif|bmp)$/i.test(f.ext ?? '')) return false; // reject image formats
  if (f.vcodec && f.vcodec !== 'none') return true;
  if (!f.vcodec && (f.height ?? 0) > 0) return true;
  if (/^(mp4|mov|webm|mkv)$/i.test(f.ext ?? '') && (f.height ?? 0) > 0) return true;
  return false;
}

/** Turn one yt-dlp info entry into proxy-able media items. */
function entryToMedia(entry: YtdlpEntry): YtdlpMediaItem[] {
  const formats = (Array.isArray(entry.formats) ? entry.formats : []).filter(
    (f) => typeof f.url === 'string',
  );

  // Video formats only (never audio-only). Prefer muxed (has audio); else best
  // by resolution — IG/FB single videos are muxed even with blank codec fields.
  const videos = formats.filter(isLikelyVideo);
  if (videos.length) {
    const muxed = videos.filter((f) => f.acodec && f.acodec !== 'none');
    const pool = (muxed.length ? muxed : videos).sort(
      (a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0),
    );
    const out: YtdlpMediaItem[] = [];
    const seen = new Set<string>();
    for (const f of pool) {
      const quality = (f.height ?? 0) >= 720 ? 'hd' : 'sd';
      if (seen.has(quality)) continue;
      seen.add(quality);
      out.push({ type: 'video', url: f.url as string, quality });
    }
    return out;
  }

  // Audio-only (SoundCloud tracks, etc.) — pick highest-bitrate audio format.
  const audios = formats.filter(isLikelyAudioOnly);
  if (audios.length) {
    const best = audios.sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
    if (best?.url) return [{ type: 'audio', url: best.url, quality: best.ext }];
  }
  
  // Photo post → image. Prefer an image-ext format; fall back to entry.url.
  const imgFmt = formats.find((f) => /^(jpe?g|png|webp|heic|gif)$/i.test(f.ext ?? ''));
  if (imgFmt?.url) return [{ type: 'image', url: imgFmt.url }];

  const isImageExt = !!entry.ext && /^(jpe?g|png|webp|heic|gif)$/i.test(entry.ext);
  if (typeof entry.url === 'string' && (isImageExt || (entry.vcodec === 'none' && entry.acodec === 'none'))) {
    return [{ type: 'image', url: entry.url }];
  }
  // Bare entry with no formats array but vcodec/acodec indicate audio-only (e.g. some SoundCloud responses).
  if (typeof entry.url === 'string' && entry.vcodec === 'none' && entry.acodec && entry.acodec !== 'none') {
    return [{ type: 'audio', url: entry.url }];
  }
  
  if (typeof entry.url === 'string') return [{ type: 'image', url: entry.url }];
  return [];
}

/**
 * Extract metadata + direct media URLs for a post/reel/video without writing
 * anything to disk. Supports single items and carousels (playlist entries).
 */
export async function ytdlpGetInfo(url: string): Promise<YtdlpInfo> {
  const cookies = getCookiesPath();
  const proxyArgs = getProxyArgs();
  const baseArgs = [
    '--no-warnings',
    '-J',
    '--playlist-end', '20',
  ];

  // Direct first, proxy only as a fallback — see ytdlpDownloadAudio for why.
  const directArgs = [
    ...baseArgs,
    ...YTDLP_CLIENT_ARGS,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', directArgs, {
      timeout: 45_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  } catch (err) {
    if (!proxyArgs.length) throw err;
    const proxiedArgs = [
      ...baseArgs,
      ...YTDLP_CLIENT_ARGS_FALLBACK,
      ...proxyArgs,
      ...(cookies ? ['--cookies', cookies] : []),
      url,
    ];
    ({ stdout } = await execFileAsync('yt-dlp', proxiedArgs, {
      timeout: 120_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  }

  const data = JSON.parse(stdout) as YtdlpEntry & { entries?: YtdlpEntry[] };
  const entries: YtdlpEntry[] = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [data];

  const media: YtdlpMediaItem[] = [];
  const seenUrls = new Set<string>();
  for (const entry of entries) {
    for (const m of entryToMedia(entry)) {
      if (seenUrls.has(m.url)) continue;
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
    thumbnail: (data.thumbnail || head.thumbnail || null) as string | null,
    duration: typeof durationRaw === 'number' ? durationRaw : null,
    media,
  };
}


// ─── Fast audio extraction: direct URL, no download ──────────────────────────
//
// For ytplay: one yt-dlp call returns metadata + a direct audio-only CDN URL.
// The signed proxy streams it, so nothing touches disk and ffmpeg never runs.
// Cuts a ~90s download+transcode down to a single ~5s extraction call.

export interface YtAudioDirect {
  title: string;
  author: string;
  thumbnail: string | null;
  duration: number | null;
  audioUrl: string;
  ext: string;
}

export async function ytdlpGetAudioUrl(url: string): Promise<YtAudioDirect> {
  const cookies = getCookiesPath();
  const proxyArgs = getProxyArgs();

  // No -f here: with -J it filters formats away and can fail outright.
  // We pick from the full `formats` array ourselves below.
  const baseArgs = [
    '--no-warnings',
    '-J',
    '--no-playlist',
  ];

  // Direct (no proxy) resolves in ~6s; the upstream proxy takes minutes, so
  // it is only worth using when the direct attempt actually fails.
  const directArgs = [
    ...baseArgs,
    ...YTDLP_CLIENT_ARGS,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('yt-dlp', directArgs, {
      timeout: 30_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  } catch (err) {
    if (!proxyArgs.length) throw err;
    const proxiedArgs = [
      ...baseArgs,
      ...YTDLP_CLIENT_ARGS_FALLBACK,
      ...proxyArgs,
      ...(cookies ? ['--cookies', cookies] : []),
      url,
    ];
    ({ stdout } = await execFileAsync('yt-dlp', proxiedArgs, {
      timeout: 90_000,
      maxBuffer: 20 * 1024 * 1024,
    }));
  }

  const raw = JSON.parse(stdout) as YtdlpEntry & { entries?: YtdlpEntry[]; url?: string };
  // ytsearch wraps the hit in a playlist — unwrap to the first entry.
  const data = Array.isArray(raw.entries) ? (raw.entries[0] ?? raw) : raw;

  const formats = (Array.isArray(data.formats) ? data.formats : []).filter(
    (f) => typeof f.url === 'string' && f.ext !== 'mhtml',
  );

  // Prefer real audio-only formats, highest bitrate first.
  const audioOnly = formats
    .filter((f) => f.vcodec === 'none' && !!f.acodec && f.acodec !== 'none')
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0));

  let chosen = audioOnly[0];

  // Fallback: any muxed format that at least carries audio (format 18, etc.)
  if (!chosen) {
    chosen = formats
      .filter((f) => !!f.acodec && f.acodec !== 'none')
      .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  }

  const audioUrl = chosen?.url ?? data.url;
  if (!audioUrl) throw new Error('yt-dlp returned no playable audio URL');

  return {
    title: (data.title || 'YouTube Audio').toString().replace(/\s+/g, ' ').trim().slice(0, 200),
    author: (data.uploader || data.channel || '').toString(),
    thumbnail: (data.thumbnail || null) as string | null,
    duration: typeof data.duration === 'number' ? data.duration : null,
    audioUrl,
    ext: chosen?.ext ?? 'm4a',
  };
}

// ─── Audio loudness normalization (EBU R128) ─────────────────────────────────
//
// TikTok (and some other) source audio is often mastered very quietly
// (~-26 dB mean). This downloads a remote audio URL and re-encodes it through
// ffmpeg's `loudnorm` filter to a consistent target (~-14 LUFS), so the MP3 a
// user gets is at a normal, comparable volume. Returns a temp file path.

export interface NormalizedAudio {
  filePath: string;
}

/**
 * Fetch `sourceUrl` (optionally with custom headers, e.g. a Referer that the
 * TikTok CDN requires), then normalize loudness to a temp mp3 via ffmpeg.
 */
const DEFAULT_AUDIO_FILTER =
  'loudnorm=I=-13:TP=-1.5,acompressor=threshold=-20dB:ratio=4:attack=5:release=80:makeup=2,alimiter=level_in=1:level_out=1:limit=0.89';

export async function downloadAndNormalizeAudio(
  sourceUrl: string,
  opts: { headers?: Record<string, string>; bitrate?: string; filter?: string } = {},
): Promise<NormalizedAudio> {
  const id = randomBytes(8).toString('hex');
  const inputPath = join(TEMP_DIR, `${id}.src`);
  const outputPath = join(TEMP_DIR, `${id}.mp3`);

  const filter = opts.filter || loadEnv().AUDIO_LOUDNESS_FILTER || DEFAULT_AUDIO_FILTER;

  const res = await fetch(sourceUrl, { headers: opts.headers, signal: AbortSignal.timeout(30_000) });
  if (!res.ok || !res.body) throw new Error(`audio source fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('audio source returned empty body');
  writeFileSync(inputPath, buf);

  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', inputPath,
      '-af', filter,
      '-c:a', 'libmp3lame', '-b:a', opts.bitrate ?? '192k',
      outputPath,
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
  } finally {
    try { unlinkSync(inputPath); } catch { /* ignore */ }
  }

  if (!existsSync(outputPath)) throw new Error('ffmpeg did not produce normalized audio');
  return { filePath: outputPath };
}
