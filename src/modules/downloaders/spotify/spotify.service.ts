import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { parseFile } from 'music-metadata';
import { AppError } from '@shared/errors.js';
import { storeSpotifyFile } from './spotify.store.js';
import { shortProxyUrl } from '@modules/downloaders/_proxy/proxy.token.js';

const execFileAsync = promisify(execFile);

const TEMP_BASE = join(tmpdir(), 'rex-spotify');
mkdirSync(TEMP_BASE, { recursive: true });

export interface SpotifyTrack {
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  url: string;
}

function detectType(input: string): 'track' | 'album' | 'playlist' {
  if (input.includes('/track/')) return 'track';
  if (input.includes('/album/')) return 'album';
  if (input.includes('/playlist/')) return 'playlist';
  return 'track';
}

function isSpotifyUrl(input: string): boolean {
  return /^https?:\/\/open\.spotify\.com\/(track|album|playlist)\//i.test(input);
}

async function readMp3Meta(filePath: string) {
  try {
    const meta = await parseFile(filePath, { duration: true });
    return {
      title: meta.common.title ?? null,
      artist: meta.common.artist ?? null,
      album: meta.common.album ?? null,
      duration: meta.format.duration ? Math.round(meta.format.duration) : null,
    };
  } catch {
    return { title: null, artist: null, album: null, duration: null };
  }
}

function parseFilename(file: string): { title: string; artist: string } {
  const nameWithoutExt = file.replace(/\.mp3$/, '');
  const dashIdx = nameWithoutExt.lastIndexOf(' - ');
  return {
    title: dashIdx !== -1 ? nameWithoutExt.slice(0, dashIdx).trim() : nameWithoutExt,
    artist: dashIdx !== -1 ? nameWithoutExt.slice(dashIdx + 3).trim() : 'Unknown',
  };
}

export async function downloadSpotify(
  input: string,
  base: string,
): Promise<{ type: 'track' | 'album' | 'playlist'; tracks: SpotifyTrack[] }> {
  const type = detectType(input);
  const tempDir = join(TEMP_BASE, `${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const spotdlQuery = isSpotifyUrl(input) ? input.split('?')[0] : input.trim();
  const cookiesPath = process.env['YTDLP_COOKIES_PATH'] ?? './cookies.txt';

  try {
    const { stdout, stderr } = await execFileAsync('spotdl', [
      'download',
      spotdlQuery,
      '--output', `${tempDir}/{title} - {artists}`,
      '--format', 'mp3',
      '--bitrate', '128k',
      '--no-cache',
      '--audio', 'youtube-music',
      '--cookie-file', cookiesPath,
      '--threads', '4',
      '--yt-dlp-args', '--no-playlist --socket-timeout 10 --retries 2 --no-warnings',
    ], { timeout: 5 * 60 * 1000 });

    console.log('[spotify] stdout:', stdout?.slice(0, 500));
    if (stderr) console.log('[spotify] stderr:', stderr?.slice(0, 300));

    const files = readdirSync(tempDir).filter((f) => f.endsWith('.mp3'));
    if (files.length === 0) {
      throw new AppError(502, 'SPOTIFY_DOWNLOAD_FAILED', 'Lagu tidak ditemukan atau gagal didownload');
    }

    // Download semua track paralel (penting untuk album/playlist)
    const tracks: SpotifyTrack[] = await Promise.all(
      files.map(async (file) => {
        const filePath = join(tempDir, file);
        const meta = await readMp3Meta(filePath);
        const fallback = parseFilename(file);

        const fileId = storeSpotifyFile(filePath, file);
        const internalUrl = `${base}/api/downloader/spotify/file/${fileId}`;
        const url = shortProxyUrl(base, internalUrl, {
          filename: file,
          contentType: 'audio/mpeg',
          ttlSec: 10 * 60,
        });

        return {
          title: meta.title ?? fallback.title,
          artist: meta.artist ?? fallback.artist,
          album: meta.album,
          duration: meta.duration,
          url,
        };
      }),
    );

    return { type, tracks };
  } catch (err: any) {
    try {
      for (const f of readdirSync(tempDir)) unlinkSync(join(tempDir, f));
    } catch { /* ignore */ }

    if (err instanceof AppError) throw err;
    if (err.code === 'ENOENT') {
      throw new AppError(503, 'SPOTDL_NOT_INSTALLED', 'spotdl tidak ditemukan. Install dengan: pip install spotdl');
    }
    if (err.killed || err.signal === 'SIGTERM') {
      throw new AppError(504, 'SPOTIFY_TIMEOUT', 'Download timeout — coba lagi atau gunakan track tunggal');
    }
    const stderr = err.stderr?.toString() ?? '';
    throw new AppError(502, 'SPOTIFY_ERROR', stderr.slice(0, 300) || err.message);
  }
}