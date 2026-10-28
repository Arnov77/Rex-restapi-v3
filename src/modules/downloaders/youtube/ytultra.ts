/**
 * YouTube downloader via ytultra.com API + YouTube oEmbed (untuk metadata akurat).
 */

import axios from 'axios';
import { loadEnv } from '../../../config/env.js';

const YTULTRA_API = 'https://api.ytultra.com/ikool/youtube/download';
const YOUTUBE_SEARCH_API = 'https://www.googleapis.com/youtube/v3/search';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const AUDIO_RE = /kbps|audio only|audio-only|\.m4a\]|\.mp3\]|\.aac\]|\.weba\]|weba|opus/i;

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function extractVideoId(url: string): string | null {
  const raw = String(url || '').trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  const m = raw.match(
    /youtu\.be\/([\w-]{11})|youtube\.com\/(?:embed\/|v\/|shorts\/|live\/)([\w-]{11})|[?&]v=([\w-]{11})/i,
  );
  return m ? m[1] || m[2] || m[3] || null : null;
}

function isAudio(m: YtultraMedia): boolean {
  return AUDIO_RE.test(String(m.format || '')) || AUDIO_RE.test(String(m.quality || ''));
}

function getHeight(m: YtultraMedia): number {
  const q = String(m.quality || '');
  const n = q.match(/(\d{2,4})\s*p/i);
  if (n?.[1]) return parseInt(n[1], 10);
  if (/4k/i.test(q)) return 2160;
  if (/2k/i.test(q)) return 1440;
  return 0;
}

export function formatSize(bytes?: number, sizeStr?: string): string {
  if (sizeStr) return sizeStr;
  const s = Number(bytes);
  if (!Number.isFinite(s) || s <= 0) return '-';
  if (s >= 1073741824) return (s / 1073741824).toFixed(2) + ' GB';
  if (s >= 1048576) return (s / 1048576).toFixed(2) + ' MB';
  if (s >= 1024) return (s / 1024).toFixed(1) + ' KB';
  return s + ' B';
}

// ─── Metadata via Official YouTube oEmbed ───────────────────────────────────

interface YoutubeOembed {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

async function fetchYoutubeOembed(id: string): Promise<YoutubeOembed | null> {
  try {
    const res = await axios.get<YoutubeOembed>(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
      { timeout: 5000, headers: { 'User-Agent': UA } },
    );
    return res.data;
  } catch {
    return null;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface YtultraMedia {
  quality: string;
  format: string;
  fileSize?: number;
  sizeStr?: string;
  url?: string;
  locked?: boolean;
}

interface YtultraRaw {
  code: string | number;
  msg?: string;
  message?: string;
  data?: {
    title?: string;
    duration?: number | string;
    imageUrl?: string;
    medias?: YtultraMedia[];
  };
}

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

export interface YtAudioResult {
  id: string;
  title: string;
  author: { name: string; username: string; url: string };
  thumbnail: string | null;
  duration: number | null;
  audioUrl: string;
  quality: string;
  format: string;
  size: string;
}

export interface YtSearchResult {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnail: string | null;
}

// ─── Video Download ──────────────────────────────────────────────────────────

export async function ytultraGetVideo(url: string, requestedQuality: string = '720'): Promise<YtVideoResult> {
  const id = extractVideoId(url);
  if (!id) throw new Error('URL atau ID YouTube tidak valid.');

  // Ambil metadata oembed dan stream video secara paralel
  const [oembed, res] = await Promise.all([
    fetchYoutubeOembed(id),
    axios.post<YtultraRaw>(
      YTULTRA_API,
      { url: `https://www.youtube.com/watch?v=${id}` },
      {
        timeout: 30_000,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: 'https://www.ytultra.com',
          Referer: 'https://www.ytultra.com/',
          'User-Agent': UA,
        },
      },
    ),
  ]);

  const body = res.data;
  const code = String(body.code);
  if (code !== '0000' && code !== '0') {
    throw new Error(body.msg || body.message || `ytultra error (code: ${body.code})`);
  }

  const data = body.data ?? {};
  const rawMedias = data.medias ?? [];

  const unlockedVideos = rawMedias
    .filter((m) => !isAudio(m) && m.url && m.locked !== true)
    .sort((a, b) => getHeight(b) - getHeight(a));

  if (!unlockedVideos.length) {
    throw new Error('Tidak ditemukan video yang dapat diunduh.');
  }

  const authorName = oembed?.author_name || '';
  const authorUrl = oembed?.author_url || '';
  const authorUsername = authorUrl ? authorUrl.split('/').pop() || '' : '';
  const title = oembed?.title || data.title || 'YouTube Video';
  const duration = data.duration ? Number(data.duration) : null;
  const thumbnail = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

  const mediaList: YtVideoMediaItem[] = unlockedVideos.map((v) => ({
    type: 'video',
    url: v.url!,
    quality: v.quality || '720p',
    format: (String(v.format || '').match(/\[\.(\w+)\]/i)?.[1] || 'mp4').toLowerCase(),
    size: formatSize(v.fileSize, v.sizeStr),
  }));

  return {
    id,
    title,
    author: { name: authorName, username: authorUsername, url: authorUrl },
    thumbnail: oembed?.thumbnail_url || thumbnail,
    duration,
    media: mediaList,
  };
}

// ─── Audio Download ──────────────────────────────────────────────────────────

export async function ytultraGetAudio(url: string): Promise<YtAudioResult> {
  const id = extractVideoId(url);
  if (!id) throw new Error('URL atau ID YouTube tidak valid.');

  const [oembed, res] = await Promise.all([
    fetchYoutubeOembed(id),
    axios.post<YtultraRaw>(
      YTULTRA_API,
      { url: `https://www.youtube.com/watch?v=${id}` },
      {
        timeout: 30_000,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Origin: 'https://www.ytultra.com',
          Referer: 'https://www.ytultra.com/',
          'User-Agent': UA,
        },
      },
    ),
  ]);

  const body = res.data;
  const code = String(body.code);
  if (code !== '0000' && code !== '0') {
    throw new Error(body.msg || body.message || `ytultra error (code: ${body.code})`);
  }

  const data = body.data ?? {};
  const rawMedias = data.medias ?? [];

  const audios = rawMedias.filter((m) => isAudio(m) && m.url && m.locked !== true);
  const fallbackVideos = rawMedias
    .filter((m) => !isAudio(m) && m.url && m.locked !== true)
    .sort((a, b) => getHeight(a) - getHeight(b));

  const pick = audios[0] ?? fallbackVideos[0];
  if (!pick?.url) throw new Error('Tidak ditemukan audio yang dapat diunduh.');

  const authorName = oembed?.author_name || '';
  const authorUrl = oembed?.author_url || '';
  const authorUsername = authorUrl ? authorUrl.split('/').pop() || '' : '';
  const title = oembed?.title || data.title || 'YouTube Audio';
  const duration = data.duration ? Number(data.duration) : null;
  const thumbnail = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

  return {
    id,
    title,
    author: { name: authorName, username: authorUsername, url: authorUrl },
    thumbnail: oembed?.thumbnail_url || thumbnail,
    duration,
    audioUrl: pick.url,
    quality: pick.quality || '128kbps',
    format: 'mp3',
    size: formatSize(pick.fileSize, pick.sizeStr),
  };
}

// ─── YouTube Search (Data API v3) ────────────────────────────────────────────

export async function ytSearch(query: string): Promise<YtSearchResult> {
  const env = loadEnv();
  if (!env.YOUTUBE_API_KEY) throw new Error('YOUTUBE_API_KEY is not configured');

  const res = await axios.get(YOUTUBE_SEARCH_API, {
    timeout: 10_000,
    params: {
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: 1,
      key: env.YOUTUBE_API_KEY,
    },
  });

  const item = res.data?.items?.[0];
  if (!item) throw new Error('Pencarian YouTube tidak menemukan hasil.');

  const videoId: string = item.id?.videoId;
  const snippet = item.snippet ?? {};

  return {
    videoId,
    title: snippet.title ?? 'YouTube Video',
    channelTitle: snippet.channelTitle ?? '',
    thumbnail:
      snippet.thumbnails?.high?.url ??
      snippet.thumbnails?.medium?.url ??
      snippet.thumbnails?.default?.url ??
      null,
  };
}