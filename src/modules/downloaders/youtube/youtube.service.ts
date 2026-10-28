import { ytultraGetVideo, type YtVideoResult } from './ytultra.js';

export async function downloadYoutube(url: string, quality: string = '720'): Promise<YtVideoResult> {
  return ytultraGetVideo(url, quality);
}