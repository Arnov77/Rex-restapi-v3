/**
 * YouTube video download — scrapr only.
 *
 * Same reason as the audio resolver (see youtubeAudio.ts): the old
 * ytultra fallback returned googlevideo URLs, and googlevideo rejects
 * requests from datacenter IPs, which made `/p/` video links return 502
 * from the panel. That fallback was removed on purpose — if both scrapr
 * methods fail, this throws an aggregated error instead of returning a
 * link that 502s.
 *
 * Chain (sequential, first success wins):
 *   1. scrapr youtube.ytmp3  (mp4, convert1s + ytmp3.mobi fallback inside)
 *   2. scrapr youtube.ytmp3gg (mp4 at the requested quality, convert1s)
 *
 * Note: scrapr converts a single quality per call, so the scrapr path
 * returns one video item (720p from ytmp3, requested quality from
 * ytmp3gg). The route's quality filter handles that shape.
 */

import scrapr from '@coflyn/scrapr';
import { extractVideoId, fetchOembed, authorFromOembed, fetchVideoDuration } from './youtubeAudio.js';

export type VideoSource = 'scrapr-ytmp3' | 'scrapr-ytmp3gg';

export interface YtVideoMediaItem {
  type: 'video';
  url: string;
  quality: string;
  format: string;
  size: string;
}

export interface YtVideoResult {
  id: string;
  title: string;
  author: { name: string; username: string; url: string };
  thumbnail: string | null;
  duration: number | null;
  media: YtVideoMediaItem[];
}

export interface YoutubeVideo extends YtVideoResult {
  source: VideoSource;
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

/** Only accept real video downloads — never serve an audio file as video. */
function pickVideo(res: ScraprResult): ScraprDownload | null {
  const downloads = res.result?.downloads ?? [];
  return downloads.find((d) => d.type === 'video' && typeof d.url === 'string') ?? null;
}

function toMediaItem(dl: ScraprDownload): YtVideoMediaItem {
  return {
    type: 'video',
    url: dl.url as string,
    quality: dl.quality || '720p',
    format: 'mp4',
    size: '-',
  };
}

export async function downloadYoutube(url: string, quality: string = '720'): Promise<YoutubeVideo> {
  const id = extractVideoId(url);
  if (!id) throw new Error('URL atau ID YouTube tidak valid.');

  // Started up front so they run in parallel with the (slow) conversion calls.
  const oembedPromise = fetchOembed(id);
  const durationPromise = fetchVideoDuration(id);

  // Failure reasons are collected so a total failure names every link
  // that broke.
  const failures: string[] = [];

  // 1. scrapr ytmp3 (mp4 — convert1s at 720p, with ytmp3.mobi fallback inside)
  try {
    const res = (await scrapr.youtube.ytmp3(url, 'mp4')) as ScraprResult;
    const dl = res.status ? pickVideo(res) : null;
    if (dl?.url) {
      const oembed = await oembedPromise;
      return {
        id,
        title: res.result?.title || oembed?.title || 'YouTube Video',
        author: authorFromOembed(oembed),
        thumbnail: res.result?.thumbnail || oembed?.thumbnail_url || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        duration: await durationPromise,
        media: [toMediaItem(dl)],
        source: 'scrapr-ytmp3',
      };
    }
    failures.push(`scrapr-ytmp3: ${res.message || 'no video download'}`);
  } catch (err) {
    failures.push(`scrapr-ytmp3: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  // 2. scrapr ytmp3gg (mp4 at the requested quality)
  try {
    const res = (await scrapr.youtube.ytmp3gg(url, { format: 'mp4', quality: `${quality}p` })) as ScraprResult;
    const dl = res.status ? pickVideo(res) : null;
    if (dl?.url) {
      const oembed = await oembedPromise;
      return {
        id,
        title: res.result?.title || oembed?.title || 'YouTube Video',
        author: authorFromOembed(oembed),
        thumbnail: res.result?.thumbnail || oembed?.thumbnail_url || `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
        duration: await durationPromise,
        media: [toMediaItem(dl)],
        source: 'scrapr-ytmp3gg',
      };
    }
    failures.push(`scrapr-ytmp3gg: ${res.message || 'no video download'}`);
  } catch (err) {
    failures.push(`scrapr-ytmp3gg: ${err instanceof Error ? err.message : 'unknown error'}`);
  }

  // Both scrapr methods failed — throw instead of returning a link
  // that would 502 (the old ytultra fallback did exactly that).
  throw new Error(`Semua resolver YouTube gagal — ${failures.join('; ')}`);
}
