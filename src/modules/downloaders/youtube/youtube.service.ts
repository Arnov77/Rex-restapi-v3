/**
 * YouTube downloader service.
 *
 * Uses yt-dlp to download+merge video+audio into a single mp4.
 * Returns a local file path that gets served via a temp file route.
 *
 * Requires: yt-dlp + deno + ffmpeg installed on the system.
 */

import { ytdlpDownloadVideo } from './ytdlp.js';

export interface YoutubeResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video'; filePath: string; quality?: string }>;
}

/**
 * Download YouTube video — single best quality via yt-dlp (merged mp4).
 */
export async function downloadYoutube(url: string, quality: string = '720'): Promise<YoutubeResult> {
  const result = await ytdlpDownloadVideo(url, quality);

  return {
    title: result.title,
    author: { name: result.author, username: '' },
    thumbnail: result.thumbnail,
    duration: result.duration,
    media: [{ type: 'video', filePath: result.filePath, quality: `${quality}p` }],
  };
}
