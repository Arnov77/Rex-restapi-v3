/**
 * YouTube downloader service.
 *
 * Primary: yt-dlp (most reliable for YouTube, handles auth/restrictions).
 * Requires: yt-dlp + deno installed, cookies.txt in project root.
 */

import { ytdlpGetVideo } from './ytdlp.js';

export interface YoutubeResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video'; url: string; quality?: string }>;
}

/**
 * Download YouTube video — multiple qualities via yt-dlp.
 */
export async function downloadYoutube(url: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const qualities = ['1080', '720', '480', '360'];
  const media: YoutubeResult['media'] = [];
  let meta: { title: string; author: string; thumbnail: string | null; duration: number | null } | null = null;

  for (const q of qualities) {
    try {
      const result = await ytdlpGetVideo(url, q);
      if (result.url) {
        if (!meta) {
          meta = { title: result.title, author: result.author, thumbnail: result.thumbnail, duration: result.duration };
        }
        media.push({ type: 'video', url: result.url, quality: `${q}p` });
      }
    } catch {
      // skip this quality
    }
  }

  if (!meta || media.length === 0) {
    throw new Error('YouTube download failed: yt-dlp could not extract any streams');
  }

  // Deduplicate (different quality requests may return same URL)
  const seen = new Set<string>();
  const dedupedMedia = media.filter(m => {
    if (seen.has(m.url)) return false;
    seen.add(m.url);
    return true;
  });

  return {
    title: meta.title,
    author: { name: meta.author, username: '' },
    thumbnail: meta.thumbnail,
    duration: meta.duration,
    media: dedupedMedia,
  };
}
