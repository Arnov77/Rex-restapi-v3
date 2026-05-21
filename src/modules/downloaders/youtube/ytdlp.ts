/**
 * yt-dlp wrapper for YouTube downloads.
 * Used as fallback when cobalt fails (e.g. YouTube login required).
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
  audioUrl: string | null;
}

function getCookiesPath(): string | null {
  const env = loadEnv();
  const p = resolve(process.cwd(), env.YTDLP_COOKIES_PATH);
  return existsSync(p) ? p : null;
}

/**
 * Get video info + best stream URL via yt-dlp.
 */
export async function ytdlpGetVideo(url: string, quality: string = '720'): Promise<YtdlpResult> {
  const cookies = getCookiesPath();
  const args = [
    '--no-warnings',
    '-j',
    '--no-playlist',
    '-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]/b`,
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
    url: data.url || data.requested_downloads?.[0]?.url || '',
    audioUrl: null,
  };
}

/**
 * Get audio-only URL via yt-dlp.
 */
export async function ytdlpGetAudio(url: string): Promise<YtdlpResult> {
  const cookies = getCookiesPath();
  const args = [
    '--no-warnings',
    '-j',
    '--no-playlist',
    '-f', 'ba/b',
    '-x',
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
    url: data.url || data.requested_downloads?.[0]?.url || '',
    audioUrl: data.url || null,
  };
}

/**
 * Get direct download URL (no JSON metadata, just the URL).
 */
export async function ytdlpGetUrl(url: string, format: string = 'bv*[height<=720]+ba/b'): Promise<string> {
  const cookies = getCookiesPath();
  const args = [
    '--no-warnings',
    '--get-url',
    '--no-playlist',
    '-f', format,
    ...(cookies ? ['--cookies', cookies] : []),
    url,
  ];

  const { stdout } = await execFileAsync('yt-dlp', args, {
    timeout: 30_000,
  });

  return stdout.trim().split('\n')[0]!;
}
