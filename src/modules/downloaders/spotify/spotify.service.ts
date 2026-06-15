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
  playlist: string | null;
  duration: number | null;
  url: string;
}

// ─── Spotify Auth ─────────────────────────────────────────────────────────────

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getSpotifyToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 5000) {
    return cachedToken.token;
  }

  const clientId = process.env['SPOTIFY_CLIENT_ID'];
  const clientSecret = process.env['SPOTIFY_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new AppError(503, 'SPOTIFY_NO_CREDENTIALS', 'SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET belum diset');
  }

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) {
    throw new AppError(502, 'SPOTIFY_AUTH_FAILED', `Spotify auth gagal: HTTP ${res.status}`);
  }

  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.token;
}

// ─── Spotify Metadata ─────────────────────────────────────────────────────────

interface SpotifyTrackMeta {
  title: string;
  artist: string;
  album: string | null;
  duration: number | null; // detik
  spotifyId: string;
}

interface SpotifyAlbumMeta {
  tracks: SpotifyTrackMeta[];
}

function extractTrackMeta(item: any): SpotifyTrackMeta {
  return {
    title: item.name ?? 'Unknown',
    artist: (item.artists as any[])?.map((a: any) => a.name).join(', ') ?? 'Unknown',
    album: item.album?.name ?? null,
    duration: item.duration_ms ? Math.round(item.duration_ms / 1000) : null,
    spotifyId: item.id,
  };
}

async function fetchTrackMeta(id: string, token: string): Promise<SpotifyTrackMeta> {
  const res = await fetch(`https://api.spotify.com/v1/tracks/${id}?market=ID`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new AppError(403, 'SPOTIFY_TRACK_NOT_FOUND', `Track tidak ditemukan: ${id} (HTTP ${res.status})`);
  }
  return extractTrackMeta(await res.json());
}

async function fetchAlbumMeta(id: string, token: string): Promise<SpotifyTrackMeta[]> {
  const res = await fetch(`https://api.spotify.com/v1/albums/${id}/tracks?limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AppError(404, 'SPOTIFY_ALBUM_NOT_FOUND', `Album tidak ditemukan: ${id}`);
  const json = await res.json() as { items: any[] };

  // Album tracks tidak include album name, fetch album dulu
  const albumRes = await fetch(`https://api.spotify.com/v1/albums/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const albumJson = await albumRes.json() as { name: string };

  return json.items.map((item: any) => ({
    ...extractTrackMeta(item),
    album: albumJson.name,
  }));
}

async function fetchPlaylistMeta(id: string, token: string): Promise<SpotifyTrackMeta[]> {
  const tracks: SpotifyTrackMeta[] = [];
  let url: string | null = `https://api.spotify.com/v1/playlists/${id}/tracks?limit=50&fields=next,items(track(id,name,artists,album,duration_ms))`;

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
    throw new AppError(404, 'SPOTIFY_PLAYLIST_NOT_FOUND', `Playlist tidak ditemukan: ${id}`);
  }
    const json = await res.json() as { items: any[]; next: string | null };
    for (const item of json.items) {
      if (item.track) tracks.push(extractTrackMeta(item.track));
    }
    url = json.next;
  }
  return tracks;
}

async function searchTrackMeta(query: string, token: string): Promise<SpotifyTrackMeta> {
  const res = await fetch(
    `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=1`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new AppError(502, 'SPOTIFY_SEARCH_FAILED', 'Gagal search di Spotify');
  const json = await res.json() as { tracks: { items: any[] } };
  const item = json.tracks?.items?.[0];
  if (!item) throw new AppError(404, 'SPOTIFY_NOT_FOUND', `Lagu tidak ditemukan: "${query}"`);
  return extractTrackMeta(item);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectType(input: string): 'track' | 'album' | 'playlist' {
  if (input.includes('/track/')) return 'track';
  if (input.includes('/album/')) return 'album';
  if (input.includes('/playlist/')) return 'playlist';
  return 'track';
}

function isSpotifyUrl(input: string): boolean {
  return /^https?:\/\/open\.spotify\.com\/(track|album|playlist)\//i.test(input);
}

function extractSpotifyId(url: string): string {
  const match = url.match(/\/(track|album|playlist)\/([A-Za-z0-9]+)/);
  if (!match) throw new AppError(400, 'INVALID_SPOTIFY_URL', `URL Spotify tidak valid: ${url}`);
  return match[2]!;
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

// ─── Download via yt-dlp ──────────────────────────────────────────────────────

async function downloadTrack(
  meta: SpotifyTrackMeta,
  tempDir: string,
  cookiesPath: string,
): Promise<string> {
  // Cari di YouTube Music dengan query: "judul artis"
  const query = `${meta.title} ${meta.artist}`;
  const outTemplate = join(tempDir, `${meta.spotifyId}.%(ext)s`);

  await execFileAsync('yt-dlp', [
    `ytsearch1:${query}`,
    '--format', 'bestaudio[ext=m4a]/bestaudio',
    '--output', outTemplate,
    '--no-playlist',
    '--cookies', cookiesPath,
    '--no-warnings',
    '--quiet',
  ], { timeout: 60 * 1000 });

  // Cari file hasil download
  const files = readdirSync(tempDir).filter((f) => f.startsWith(meta.spotifyId) && (f.endsWith('.m4a') || f.endsWith('.webm') || f.endsWith('.opus')));
  if (!files.length) throw new AppError(502, 'DOWNLOAD_FAILED', `Gagal download: ${query}`);
  return join(tempDir, files[0]!);
}


// ─── Playlist via Spotify Embed scrape + yt-dlp ──────────────────────────────

interface EmbedTrack {
  name: string;
  artist: string;
  album_name: string | null;
  duration: number | null;
  song_id: string;
}

async function fetchPlaylistTracksViaEmbed(playlistId: string): Promise<{ tracks: EmbedTrack[]; playlistName: string }> {
  const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}?utm_source=oembed`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });

  if (!res.ok) throw new AppError(502, 'SPOTIFY_EMBED_FAILED', `Gagal fetch embed: HTTP ${res.status}`);

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
  if (!match) throw new AppError(502, 'SPOTIFY_EMBED_PARSE_FAILED', 'Tidak bisa parse embed Spotify');

  const json = JSON.parse(match[1]!);
  const entity = json?.props?.pageProps?.state?.data?.entity;
  const trackList: any[] = entity?.trackList ?? [];
  const playlistName: string = entity?.name ?? 'Unknown Playlist';

  if (!trackList.length) throw new AppError(404, 'SPOTIFY_PLAYLIST_EMPTY', 'Playlist kosong');

  const tracks = trackList.map((t: any) => ({
    name: t.title ?? 'Unknown',
    artist: t.subtitle ?? 'Unknown',
    album_name: null as string | null,
    duration: t.duration ? Math.round(t.duration / 1000) : null,
    song_id: t.uri?.split(':').pop() ?? String(Math.random()),
  }));

  // Enrich album name via Spotify API (batch max 50)
  try {
    const token = await getSpotifyToken();
    for (let i = 0; i < tracks.length; i += 50) {
      const ids = tracks.slice(i, i + 50).map((t) => t.song_id).join(',');
      const res = await fetch(`https://api.spotify.com/v1/tracks?ids=${ids}&market=ID`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json() as { tracks: any[] };
        json.tracks.forEach((item: any, idx: number) => {
          if (item?.album?.name) tracks[i + idx]!.album_name = item.album.name;
        });
      }
    }
  } catch {
    // Album enrichment gagal — tidak apa-apa, lanjut tanpa album
  }

  return { tracks, playlistName };
}

async function downloadWithSpotdl(
  input: string,
  type: 'track' | 'album' | 'playlist',
  tempDir: string,
  cookiesPath: string,
  base: string,
): Promise<{ type: 'track' | 'album' | 'playlist'; tracks: SpotifyTrack[] }> {
  // Step 1: Extract track list via spotdl save (cepat, tanpa download)
  const playlistId = extractSpotifyId(input);
  const { tracks: entries, playlistName } = await fetchPlaylistTracksViaEmbed(playlistId);
  if (!entries.length) {
    throw new AppError(404, 'SPOTIFY_PLAYLIST_EMPTY', 'Playlist kosong atau tidak bisa diakses');
  }

  // Step 2: Download semua track via yt-dlp parallel (concurrency 3)
  const CONCURRENCY = 3;
  const results: SpotifyTrack[] = [];

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        const meta: SpotifyTrackMeta = {
          title: entry.name,
          artist: entry.artist,
          album: entry.album_name,
          duration: entry.duration,
          spotifyId: entry.song_id,
        };

        const filePath = await downloadTrack(meta, tempDir, cookiesPath);
        const filename = `${meta.title} - ${meta.artist}.m4a`;

        const fileId = storeSpotifyFile(filePath, filename);
        const internalUrl = `${base}/api/downloader/spotify/file/${fileId}`;
        const url = shortProxyUrl(base, internalUrl, {
          filename,
          contentType: 'audio/mp4',
          ttlSec: 10 * 60,
        });

        return {
          title: meta.title,
          artist: meta.artist,
          album: meta.album,
          playlist: playlistName,
          duration: meta.duration,
          url,
        };
      }),
    );
    results.push(...batchResults);
  }
  return { type, tracks: results };
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function downloadSpotify(
  input: string,
  base: string,
): Promise<{ type: 'track' | 'album' | 'playlist'; tracks: SpotifyTrack[] }> {
  const type = detectType(input);
  const tempDir = join(TEMP_BASE, `${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const cookiesPath = process.env['YTDLP_COOKIES_PATH'] ?? './cookies.txt';

  try {
    const token = await getSpotifyToken();

    // ── Ambil metadata dari Spotify ──────────────────────────────────────
    let trackMetas: SpotifyTrackMeta[];
    if (!isSpotifyUrl(input)) {
      // Nama lagu bebas → search di Spotify
      trackMetas = [await searchTrackMeta(input, token)];
    } else {
      const id = extractSpotifyId(input);
      if (type === 'track') {
        trackMetas = [await fetchTrackMeta(id, token)];
      } else if (type === 'album') {
        trackMetas = await fetchAlbumMeta(id, token);
      } else {
        // Playlist tidak bisa diakses via Client Credentials — pakai spotdl
        return await downloadWithSpotdl(input, type, tempDir, cookiesPath, base);
      }
    }

    // ── Download semua track secara parallel (max 3 sekaligus) ──────────
    const CONCURRENCY = 3;
    const results: SpotifyTrack[] = [];

    for (let i = 0; i < trackMetas.length; i += CONCURRENCY) {
      const batch = trackMetas.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async (meta) => {
          const filePath = await downloadTrack(meta, tempDir, cookiesPath);
          const filename = `${meta.title} - ${meta.artist}.m4a`;

          const fileId = storeSpotifyFile(filePath, filename);
          const internalUrl = `${base}/api/downloader/spotify/file/${fileId}`;
          const url = shortProxyUrl(base, internalUrl, {
            filename,
            contentType: 'audio/mp4',
            ttlSec: 10 * 60,
          });

          return {
            title: meta.title,
            artist: meta.artist,
            album: meta.album,
            playlist: null,
            duration: meta.duration,
            url,
          };
        }),
      );
      results.push(...batchResults);
    }

    return { type, tracks: results };
  } catch (err: any) {
    try {
      for (const f of readdirSync(tempDir)) unlinkSync(join(tempDir, f));
    } catch { /* ignore */ }

    if (err instanceof AppError) throw err;
    if (err.code === 'ENOENT') {
      throw new AppError(503, 'YTDLP_NOT_INSTALLED', 'yt-dlp tidak ditemukan. Install dengan: pip install yt-dlp');
    }
    if (err.killed || err.signal === 'SIGTERM') {
      throw new AppError(504, 'SPOTIFY_TIMEOUT', 'Download timeout — coba lagi atau gunakan track tunggal');
    }
    const stderr = err.stderr?.toString() ?? '';
    throw new AppError(502, 'SPOTIFY_ERROR', stderr.slice(0, 300) || err.message);
  }
}