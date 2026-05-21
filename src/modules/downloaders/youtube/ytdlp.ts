/**
 * yt-dlp wrapper for YouTube downloads.
 *
 * Requires: yt-dlp + deno installed on the system.
 * Cookies file in Netscape format at YTDLP_COOKIES_PATH.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnv } from '../../../config/env.js';

const execFileAsync = promisify(execFile);

export interface YtdlpResult {
  title: string;
  author: string;
  thumbnail: string | null;
  duration: number | null;
  url: string;
}

function getCookiesPath(): string | null {
  const env = loadEnv();
  const p = resolve(process.cwd(), env.YTDLP_COOKIES_PATH);
  return existsSync(p) ? p : null;
}

/**
 * Get video metadata via yt-dlp -j (JSON dump).
 */
export async function ytdlpGetMeta(url: string): Promise<{ title: string; author: string; thumbnail: string | null; duration: number | null }> {
  const cookies = getCookiesPath();
  const args = [
    '--no-warnings',
    '-j',
    '--no-playlist',
    '--skip-download',
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  const { stdout } = await execFileAsync('yt-dlp', args, {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  const data = JSON.parse(stdout);
  return {
    title: data.title || 'YouTube Video',
    author: data.uploader || data.channel || '',
    thumbnail: data.thumbnail || null,
    duration: data.duration || null,
  };
}

/**
 * Get direct video URL for a specific quality via --get-url.
 */
export async function ytdlpGetVideoUrl(url: string, quality: string = '720'): Promise<string | null> {
  const cookies = getCookiesPath();
  const args = [
    '--no-warnings',
    '--get-url',
    '--no-playlist',
    '-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 30_000,
    });
    // Returns 1 or 2 URLs (video + audio when separate). Take first (video).
    const urls = stdout.trim().split('\n').filter(Boolean);
    return urls[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get audio-only URL via --get-url.
 */
export async function ytdlpGetAudioUrl(url: string): Promise<string | null> {
  const cookies = getCookiesPath();
  const args = [
    '--no-warnings',
    '--get-url',
    '--no-playlist',
    '-f', 'ba/b',
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  try {
    const { stdout } = await execFileAsync('yt-dlp', args, {
      timeout: 30_000,
    });
    return stdout.trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get video info + direct URL (combined helper).
 */
export async function ytdlpGetVideo(url: string, quality: string = '720'): Promise<YtdlpResult> {
  const [meta, videoUrl] = await Promise.all([
    ytdlpGetMeta(url).catch(() => ({ title: 'YouTube Video', author: '', thumbnail: null, duration: null })),
    ytdlpGetVideoUrl(url, quality),
  ]);

  if (!videoUrl) throw new Error(`No video stream found for ${quality}p`);

  return { ...meta, url: videoUrl };
}

/**
 * Get audio info + direct URL (combined helper).
 */
export async function ytdlpGetAudio(url: string): Promise<YtdlpResult> {
  const [meta, audioUrl] = await Promise.all([
    ytdlpGetMeta(url).catch(() => ({ title: 'YouTube Video', author: '', thumbnail: null, duration: null })),
    ytdlpGetAudioUrl(url),
  ]);

  if (!audioUrl) throw new Error('No audio stream found');

  return { ...meta, url: audioUrl };
}
