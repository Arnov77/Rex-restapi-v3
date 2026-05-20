/**
 * YouTube downloader service.
 *
 * Strategy: use cobalt API (self-hosted or public instance).
 * Supports video + audio extraction.
 *
 * Fallback: invidious instances (public YouTube API proxies).
 *
 * Self-host cobalt: docker run -d -p 9000:9000 ghcr.io/imputnet/cobalt:latest
 * Then set COBALT_API_URL=http://localhost:9000/
 */

import { loadEnv } from '../../../config/env.js';

export interface YoutubeResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video' | 'audio'; url: string; quality?: string }>;
}

/**
 * Extract video ID from various YouTube URL formats.
 */
function extractVideoId(url: string): string | null {
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];

  const liveMatch = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
  if (liveMatch) return liveMatch[1];

  return null;
}

/**
 * Extract title from cobalt's filename response.
 * Format: "Title - Author (quality, codec).ext"
 */
function parseCobaltFilename(filename?: string): { title: string; author: string } {
  if (!filename) return { title: 'YouTube Video', author: '' };
  // Remove extension and quality suffix
  const base = filename.replace(/\.\w+$/, '').replace(/\s*\([^)]+\)\s*$/, '');
  const parts = base.split(' - ');
  if (parts.length >= 2) {
    return { title: parts.slice(0, -1).join(' - '), author: parts[parts.length - 1] };
  }
  return { title: base, author: '' };
}

/**
 * Primary method: cobalt API.
 * Makes parallel requests for multiple video qualities + audio.
 */
async function fetchViaCobalt(url: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const env = loadEnv();
  const media: YoutubeResult['media'] = [];
  let filename: string | undefined;

  const qualities = ['1080', '720', '480', '360'];

  // Request all video qualities + audio in parallel
  const requests = [
    ...qualities.map(q =>
      fetch(env.COBALT_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ url, videoQuality: q }),
        signal,
      }).then(async res => {
        if (!res.ok) return null;
        const json = await res.json();
        if ((json.status === 'tunnel' || json.status === 'redirect' || json.status === 'stream') && json.url) {
          if (!filename) filename = json.filename;
          return { type: 'video' as const, url: json.url, quality: `${q}p` };
        }
        return null;
      }).catch(() => null)
    ),
    // Audio request
    fetch(env.COBALT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ url, downloadMode: 'audio', audioFormat: 'mp3' }),
      signal,
    }).then(async res => {
      if (!res.ok) return null;
      const json = await res.json();
      if ((json.status === 'tunnel' || json.status === 'redirect' || json.status === 'stream') && json.url) {
        return { type: 'audio' as const, url: json.url, quality: 'mp3' };
      }
      return null;
    }).catch(() => null),
  ];

  const results = await Promise.all(requests);

  // Deduplicate — cobalt may return same URL for different quality requests
  const seen = new Set<string>();
  for (const r of results) {
    if (r && !seen.has(r.url)) {
      seen.add(r.url);
      media.push(r);
    }
  }

  const { title, author } = parseCobaltFilename(filename);

  return {
    title,
    author: { name: author, username: '' },
    thumbnail: null,
    duration: null,
    media,
  };
}

/**
 * Fallback: use Invidious API to get video info + stream URLs.
 */
async function fetchViaInvidious(videoId: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const instances = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://y.com.sb',
    'https://invidious.nerdvpn.de',
  ];

  let lastErr: Error | null = null;

  for (const instance of instances) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal,
      });

      if (!res.ok) continue;
      const data = await res.json();

      const media: YoutubeResult['media'] = [];

      if (data.adaptiveFormats?.length) {
        const videos = data.adaptiveFormats
          .filter((f: any) => f.type?.startsWith('video/') && f.url)
          .sort((a: any, b: any) => {
            const aH = parseInt(a.resolution?.replace('p', '') || '0');
            const bH = parseInt(b.resolution?.replace('p', '') || '0');
            return bH - aH;
          });

        const target = videos.find((v: any) => {
          const h = parseInt(v.resolution?.replace('p', '') || '9999');
          return h <= 720;
        }) || videos[videos.length - 1];

        if (target) {
          media.push({ type: 'video', url: target.url, quality: target.resolution || target.qualityLabel });
        }

        const audio = data.adaptiveFormats.find((f: any) => f.type?.startsWith('audio/') && f.url);
        if (audio) {
          media.push({ type: 'audio', url: audio.url, quality: audio.bitrate ? `${Math.round(audio.bitrate / 1000)}kbps` : undefined });
        }
      }

      if (media.length === 0 && data.formatStreams?.length) {
        const best = data.formatStreams[data.formatStreams.length - 1];
        if (best?.url) {
          media.push({ type: 'video', url: best.url, quality: best.resolution || best.qualityLabel });
        }
      }

      const thumbnail = data.videoThumbnails?.find((t: any) => t.quality === 'maxresdefault')?.url
        || data.videoThumbnails?.[0]?.url
        || null;

      return {
        title: (data.title || 'YouTube Video').slice(0, 200),
        author: { name: data.author || '', username: data.authorId || '' },
        thumbnail,
        duration: data.lengthSeconds || null,
        media,
      };
    } catch (err: any) {
      lastErr = err;
      continue;
    }
  }

  throw lastErr || new Error('All Invidious instances failed');
}

/**
 * Download YouTube video metadata + stream URLs.
 */
export async function downloadYoutube(url: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const videoId = extractVideoId(url);

  // Try cobalt first
  try {
    const result = await fetchViaCobalt(url, signal);
    if (result.media.length > 0) return result;
  } catch {
    // fallback
  }

  // Fallback to Invidious
  if (!videoId) throw new Error('Could not extract video ID from URL');

  try {
    return await fetchViaInvidious(videoId, signal);
  } catch (err: any) {
    throw new Error(`YouTube download failed: ${err.message}`);
  }
}
