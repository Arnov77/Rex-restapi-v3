/**
 * YouTube audio resolver — scrapr only.
 *
 * scrapr's YouTube methods return files hosted on the converter services'
 * own servers (not googlevideo), so the panel proxy can fetch them. The
 * old ytultra fallback was removed on purpose: it returned googlevideo
 * URLs, and googlevideo rejects requests from datacenter IPs, which made
 * `/p/` links return 502 from the panel. If both scrapr methods fail,
 * this throws an aggregated error instead of returning a link that 502s.
 *
 * Chain (sequential, first success wins):
 *   1. scrapr youtube.ytmp3  (convert1s + ytmp3.mobi fallback inside)
 *   2. scrapr youtube.ytmp3gg (convert1s)
 */

import scrapr from '@coflyn/scrapr';

export type AudioSource = 'scrapr-ytmp3' | 'scrapr-ytmp3gg';

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

export async function getYoutubeAudio(url: string): Promise<YoutubeAudio> {
  const id = extractVideoId(url);
  if (!id) throw new Error('URL atau ID YouTube tidak valid.');

  // Started up front so it runs in parallel with the (slow) conversion calls.
  const oembedPromise = fetchOembed(id);

  // Failure reasons are collected so a total failure names every link
  // that broke.
  const failures: string[] = [];

  // 1. scrapr ytmp3 (convert1s, with ytmp3.mobi fallback inside scrapr)
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
        duration: null,
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

  // 2. scrapr ytmp3gg (convert1s)
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
        duration: null,
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

  // Both scrapr methods failed — throw instead of returning a link
  // that would 502 (the old ytultra fallback did exactly that).
  throw new Error(`Semua resolver YouTube gagal — ${failures.join('; ')}`);
}
