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
 * Returns a direct mp3/audio URL, or null if cobalt is not configured / fails.
 * Never throws — failures are returned as null so the chain continues.
 */
async function fetchViaCobalt(videoUrl: string): Promise<string | null> {
  try {
    const env = loadEnv();
    const cobaltUrl = env.COBALT_API_URL;
    if (!cobaltUrl) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    try {
      const res = await fetch(cobaltUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          url: videoUrl,
          downloadMode: 'audio',
          audioFormat: 'mp3',
          audioBitrate: '128',
        }),
        signal: controller.signal,
      });

      if (!res.ok) return null;
      if (!(res.headers.get('content-type') || '').includes('json')) return null;

      const json = (await res.json()) as {
        status?: string;
        url?: string;
        error?: { code?: string };
      };

      if (json.status === 'error' || !json.url) return null;
      return json.url;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
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

  // 1. cobalt — most reliable, self-hostable via COBALT_API_URL env
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
    failures.push('cobalt: no audio URL returned');
  } catch (err) {
    failures.push(`cobalt: ${err instanceof Error ? err.message : 'unknown error'}`);
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
