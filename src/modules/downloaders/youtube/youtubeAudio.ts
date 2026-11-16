/**
 * YouTube audio resolver.
 *
 * All resolvers return files hosted on third-party converter servers (not
 * googlevideo), so the panel proxy can fetch them without 502 errors.
 *
 * Chain (sequential, first success wins):
 *   1. cobalt  — self-hostable, reliable, returns a direct audio stream URL
 *   2. scrapr youtube.ytmp3  (convert1s + ytmp3.mobi fallback inside)
 *   3. scrapr youtube.ytmp3gg (convert1s)
 *
 * If all three fail, throws an aggregated error naming every failure.
 */

import scrapr from '@coflyn/scrapr';
import { loadEnv } from '../../../config/env.js';

export type AudioSource = 'cobalt' | 'scrapr-ytmp3' | 'scrapr-ytmp3gg';

export interface YoutubeAudio {
  id: string;
  title: string;
  author: { name: string; username: string; url: string };
  thumbnail: string | null;
  duration: number | null;
  audioUrl: string;
  quality: string;
  format: string;
  size: string;
  source: AudioSource;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export function extractVideoId(url: string): string | null {
  const raw = String(url || '').trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  const m = raw.match(
    /youtu\.be\/([\w-]{11})|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/)([\w-]{11})|[?&]v=([\w-]{11})/i,
  );
  return m ? m[1] || m[2] || m[3] || null : null;
}

export interface Oembed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

/** Best-effort metadata (title/author/thumbnail) — never throws. */
export async function fetchOembed(id: string): Promise<Oembed | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    return (await res.json()) as Oembed;
  } catch {
    return null;
  }
}

export function authorFromOembed(o: Oembed | null): YoutubeAudio['author'] {
  const name = o?.author_name || '';
  const url = o?.author_url || '';
  const username = url ? url.split('/').pop() || '' : '';
  return { name, username, url };
}

const YOUTUBE_VIDEOS_API = 'https://www.googleapis.com/youtube/v3/videos';

/** Parse an ISO 8601 duration (PT4M13S, PT1H2M3S, P1DT2H) to seconds. */
export function parseIso8601Duration(iso: string): number | null {
  const m = String(iso || '').match(/^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return null;
  const days = parseInt(m[1] || '0', 10);
  const hours = parseInt(m[2] || '0', 10);
  const minutes = parseInt(m[3] || '0', 10);
  const seconds = parseInt(m[4] || '0', 10);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/**
 * Video duration via the YouTube Data API (videos.list, contentDetails).
 * Best-effort: returns null when the key is missing, the API fails, or
 * the video is not found — a missing duration must never break a download.
 * (scrapr never returns a duration, and oEmbed has no duration field,
 * so the Data API is the only source for it.)
 */
export async function fetchVideoDuration(id: string): Promise<number | null> {
  try {
    const env = loadEnv();
    if (!env.YOUTUBE_API_KEY) return null;
    const res = await fetch(
      `${YOUTUBE_VIDEOS_API}?part=contentDetails&id=${id}&key=${env.YOUTUBE_API_KEY}`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(5000) },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: Array<{ contentDetails?: { duration?: string } }> };
    const iso = body.items?.[0]?.contentDetails?.duration;
    return iso ? parseIso8601Duration(iso) : null;
  } catch {
    return null;
  }
}

interface ScraprDownload {
  url?: string;
  type?: string;
  quality?: string;
}

interface ScraprResult {
  status?: boolean;
  message?: string;
  result?: {
    title?: string;
    thumbnail?: string | null;
    type?: string;
    downloads?: ScraprDownload[];
  };
}

/** Only accept real audio downloads — a video file must never be served as mp3. */
function pickAudio(res: ScraprResult): ScraprDownload | null {
  const downloads = res.result?.downloads ?? [];
  return downloads.find((d) => d.type === 'audio' && typeof d.url === 'string') ?? null;
}

/**
 * Cobalt resolver for YouTube audio.
 * Supports both cobalt v9 (isAudioOnly) and v10+ (downloadMode) request formats.
 * Returns a direct audio URL, or throws with a descriptive message so the
 * caller can include it in the aggregated failure list.
 */
async function fetchViaCobalt(videoUrl: string): Promise<string | null> {
  const env = loadEnv();
  const cobaltBase = env.COBALT_API_URL;
  if (!cobaltBase) return null;

  // Normalise: strip trailing slash then append the API path.
  // Cobalt v10+ uses POST /  (the root), same as v9.
  const cobaltUrl = cobaltBase.replace(/\/$/, '') + '/';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (env.COBALT_API_KEY) {
    headers['Authorization'] = `Api-Key ${env.COBALT_API_KEY}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const res = await fetch(cobaltUrl, {
      method: 'POST',
      headers,
      // v10+: downloadMode / audioFormat / audioBitrate
      // v9:   isAudioOnly / audioFormat / audioBitrate  (extra fields ignored by v10+)
      body: JSON.stringify({
        url: videoUrl,
        downloadMode: 'audio',   // v10+
        // videoQuality 'max' mengaktifkan jalur session (PO token) cobalt
        // untuk request audio: useSession hanya true bila quality > 1080 +
        // client IOS + YOUTUBE_SESSION_SERVER diset. Tanpa session server
        // nilai ini diabaikan jalur audio (pemilihan format audio tidak
        // memakai quality), jadi aman dikirim selalu.
        videoQuality: 'max',
        //isAudioOnly: true,        // v9 compat
        audioFormat: 'mp3',
        audioBitrate: '128',
      }),
      signal: controller.signal,
    });

    const rawText = await res.text();

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
    }

    let json: { status?: string; url?: string; error?: { code?: string }; text?: string };
    try {
      json = JSON.parse(rawText);
    } catch {
      throw new Error(`non-JSON response: ${rawText.slice(0, 100)}`);
    }

    if (json.status === 'error') {
      throw new Error(json.error?.code || json.text || 'cobalt error response');
    }

    // cobalt returns status: "tunnel" | "redirect" | "stream" — all carry a url
    if (!json.url) {
      throw new Error(`no url in response (status=${json.status})`);
    }

    // For tunnel URLs pointing at localhost/internal cobalt, replace the host
    // with whatever COBALT_API_URL is set to, so the stream proxy can reach it.
    // e.g. http://localhost:25412/tunnel?... stays as-is since COBALT_API_URL
    // already whitelists that host in trustedInternalHosts().
    return json.url;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getYoutubeAudio(url: string): Promise<YoutubeAudio> {
  const id = extractVideoId(url);
  if (!id) throw new Error('URL atau ID YouTube tidak valid.');

  // Started up front so they run in parallel with the (slow) conversion calls.
  const oembedPromise = fetchOembed(id);
  const durationPromise = fetchVideoDuration(id);

  // Failure reasons are collected so a total failure names every link
  // that broke.
  const failures: string[] = [];

  // 1. cobalt — self-hostable via COBALT_API_URL env (http://localhost:25412/)
  try {
    const audioUrl = await fetchViaCobalt(`https://www.youtube.com/watch?v=${id}`);
    if (audioUrl) {
      const oembed = await oembedPromise;
      return {
        id,
        title: oembed?.title || 'YouTube Audio',
        author: authorFromOembed(oembed),
        thumbnail: oembed?.thumbnail_url || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        duration: await durationPromise,
        audioUrl,
        quality: '128kbps',
        format: 'mp3',
        size: '-',
        source: 'cobalt',
      };
    }
    // fetchViaCobalt returns null only when COBALT_API_URL is not set
    failures.push('cobalt: not configured');
  } catch (err) {
    // fetchViaCobalt throws with a descriptive message on any real failure
    failures.push(`cobalt: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. scrapr ytmp3 (convert1s, with ytmp3.mobi fallback inside scrapr)
  try {
    const res = (await scrapr.youtube.ytmp3(url, 'mp3')) as ScraprResult;
    const dl = res.status ? pickAudio(res) : null;
    if (dl?.url) {
      const oembed = await oembedPromise;
      return {
        id,
        title: res.result?.title || oembed?.title || 'YouTube Audio',
        author: authorFromOembed(oembed),
        thumbnail: res.result?.thumbnail || oembed?.thumbnail_url || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        duration: await durationPromise,
        audioUrl: dl.url,
        quality: dl.quality || '128kbps',
        format: 'mp3',
        size: '-',
        source: 'scrapr-ytmp3',
      };
    }
    failures.push(`scrapr-ytmp3: ${res.message || 'no audio download'}`);
  } catch (err) {
    failures.push(`scrapr-ytmp3: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  // 3. scrapr ytmp3gg (convert1s)
  try {
    const res = (await scrapr.youtube.ytmp3gg(url, { format: 'mp3' })) as ScraprResult;
    const dl = res.status ? pickAudio(res) : null;
    if (dl?.url) {
      const oembed = await oembedPromise;
      return {
        id,
        title: res.result?.title || oembed?.title || 'YouTube Audio',
        author: authorFromOembed(oembed),
        thumbnail: res.result?.thumbnail || oembed?.thumbnail_url || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        duration: await durationPromise,
        audioUrl: dl.url,
        quality: dl.quality || '128kbps',
        format: 'mp3',
        size: '-',
        source: 'scrapr-ytmp3gg',
      };
    }
    failures.push(`scrapr-ytmp3gg: ${res.message || 'no audio download'}`);
  } catch (err) {
    failures.push(`scrapr-ytmp3gg: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  // All three resolvers failed — throw instead of returning a link that would 502.
  throw new Error(`Semua resolver YouTube gagal — ${failures.join('; ')}`);
}
