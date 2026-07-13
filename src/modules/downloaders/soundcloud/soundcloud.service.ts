import { BadRequest } from '@shared/errors.js';
import { ytdlpGetInfo } from '../youtube/ytdlp.js';

export interface SoundcloudResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  audioUrl: string;
}

export async function downloadSoundcloud(url: string): Promise<SoundcloudResult> {
  const info = await ytdlpGetInfo(url);

  const audio = info.media.find((m) => m.type === 'audio');
  if (!audio) throw BadRequest('Tidak bisa mengambil audio dari track ini (mungkin private atau geo-restricted)');

  return {
    title: info.title,
    author: info.author,
    thumbnail: info.thumbnail,
    duration: info.duration,
    audioUrl: audio.url,
  };
}