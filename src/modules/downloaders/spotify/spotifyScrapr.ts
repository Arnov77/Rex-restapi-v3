/**
 * Spotify fallback via scrapr — no Spotify credentials, no yt-dlp.
 *
 * The main flow (spotify.service.ts) needs SPOTIFY_CLIENT_ID/SECRET for
 * metadata and yt-dlp + YouTube search for the audio. This fallback
 * resolves a Spotify URL straight to an mp3 download URL through third-
 * party converters, in this order:
 *   1. spotidown    (spotidown.app)     — direct file URL, 320kbps
 *   2. spotisaver   (spotisaver.net)    — signature handshake + playlist API
 *   3. spotmate     (spotimate.app)     — userverify + multipart action
 *   4. soundloaders (spotimate.app)     — same flow as spotmate
 *
 * Every audio URL is verified with a 1-byte Range GET before it is
 * handed out, so a dead converter link fails over to the next scraper
 * instead of 502-ing later at /p/ time.
 *
 * Proven live 2026-11-19 from the VM, no credentials: spotidown converts
 * Rick Astley (track 4PTG3Z6ehGkBFwjybzWkR8) and the URL verifies 206.
 * The other three failed from the VM (spotisaver/spotmate: request
 * timeouts; soundloaders: no tracks) — they are kept as backups, they
 * may work from the panel's direct connection.
 *
 * Scope: Spotify URLs only (track/album/playlist). Free-text search
 * still needs the Spotify API, so it stays credential-gated.
 * No new dependencies: @coflyn/scrapr is already installed.
 */

import scrapr from '@coflyn/scrapr';
import type { ScraprSpotifyDownload, ScraprSpotifyResult } from '@coflyn/scrapr';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Bound per scraper call (scrapr's own axios timeouts are 8–15 s per hop). */
const SCRAPER_TIMEOUT_MS = 60_000;
const VERIFY_TIMEOUT_MS = 15_000;
/** Audio resolution runs in batches of this size (same as the API flow). */
const TRACK_CONCURRENCY = 3;
/**
 * Whole-list attempts before giving up. The converter sites drop
 * connections intermittently (socket hang up / aborted seen live
 * 2026-11-19); a second attempt usually succeeds.
 */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 2_000;

type ScraperName = 'spotidown' | 'spotisaver' | 'spotmate' | 'soundloaders';
const SCRAPERS: ScraperName[] = ['spotidown', 'spotisaver', 'spotmate', 'soundloaders'];

export interface ScraprSpotifyTrack {
  title: string;
  artist: string;
  album: string | null;
  playlist: string | null;
  duration: number | null;
  audioUrl: string;
}

export interface ScraprSpotifyResultOut {
  type: 'track' | 'album' | 'playlist';
  tracks: ScraprSpotifyTrack[];
}

function detectType(input: string): 'track' | 'album' | 'playlist' {
  if (input.includes('/track/')) return 'track';
  if (input.includes('/album/')) return 'album';
  if (input.includes('/playlist/')) return 'playlist';
  return 'track';
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms),
    ),
  ]);
}

/** First real audio download in a scraper result, or null. */
function pickAudioUrl(downloads: ScraprSpotifyDownload[] | undefined): string | null {
  const d = (downloads ?? []).find(
    (x) => (x.type === 'audio' || x.type === 'mp3') && typeof x.url === 'string' && x.url.startsWith('http'),
  );
  return d?.url ?? null;
}

/** Prove the audio URL serves bytes: 1-byte Range GET, read one chunk, cancel. */
async function verifyAudioUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      redirect: 'follow',
    });
    if (res.status !== 200 && res.status !== 206) return false;
    if (!res.body) return false;
    const reader = res.body.getReader();
    try {
      await reader.read();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}

function durationOf(item: { duration?: number; duration_ms?: number } | undefined): number | null {
  if (!item) return null;
  if (typeof item.duration === 'number') return item.duration;
  if (typeof item.duration_ms === 'number') return Math.round(item.duration_ms / 1000);
  return null;
}

async function callScraper(name: ScraperName, url: string): Promise<ScraprSpotifyResult> {
  return withTimeout(scrapr.spotify[name](url), SCRAPER_TIMEOUT_MS, name);
}

/**
 * Resolve one track URL to a verified audio URL, trying every scraper.
 * Returns null when all four fail (reasons collected in `failures`).
 */
async function resolveSingleTrack(
  trackUrl: string,
  failures: string[],
): Promise<{ title: string; artist: string; album: string | null; duration: number | null; audioUrl: string } | null> {
  for (const name of SCRAPERS) {
    let res: ScraprSpotifyResult;
    try {
      res = await callScraper(name, trackUrl);
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160));
      continue;
    }
    if (!res.status || !res.result) {
      failures.push(`${name}: ${res.message || 'gagal'}`.slice(0, 160));
      continue;
    }
    const audioUrl = pickAudioUrl(res.result.downloads);
    if (!audioUrl) {
      failures.push(`${name}: tidak ada URL audio`);
      continue;
    }
    if (!(await verifyAudioUrl(audioUrl))) {
      failures.push(`${name}: URL audio tidak lolos verifikasi`);
      continue;
    }
    const r = res.result;
    return {
      title: r.title || 'Spotify Track',
      artist: r.artist || '',
      album: r.album ?? null,
      duration: durationOf(r.tracks?.[0]),
      audioUrl,
    };
  }
  return null;
}

interface ListedTrack {
  title: string;
  artist: string;
  album: string | null;
  duration: number | null;
  trackUrl: string;
  /** Already verified audio URL, when the list step provided one. */
  audioUrl?: string;
}

/**
 * Fetch the track list for a Spotify URL from the first scraper that
 * returns one. For a single track the list has one entry (with its
 * audio URL already verified); for album/playlist it is the full list
 * with a Spotify URL per track, resolved afterwards.
 */
async function fetchTrackList(
  url: string,
  type: 'track' | 'album' | 'playlist',
  failures: string[],
): Promise<{ playlistName: string | null; tracks: ListedTrack[] }> {
  for (const name of SCRAPERS) {
    let res: ScraprSpotifyResult;
    try {
      res = await callScraper(name, url);
    } catch (err) {
      failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160));
      continue;
    }
    if (!res.status || !res.result) {
      failures.push(`${name}: ${res.message || 'gagal'}`.slice(0, 160));
      continue;
    }
    const r = res.result;

    if (type === 'track') {
      const audioUrl = pickAudioUrl(r.downloads);
      if (!audioUrl) {
        failures.push(`${name}: tidak ada URL audio`);
        continue;
      }
      if (!(await verifyAudioUrl(audioUrl))) {
        failures.push(`${name}: URL audio tidak lolos verifikasi`);
        continue;
      }
      return {
        playlistName: null,
        tracks: [
          {
            title: r.title || 'Spotify Track',
            artist: r.artist || '',
            album: r.album ?? null,
            duration: durationOf(r.tracks?.[0]),
            trackUrl: url,
            audioUrl,
          },
        ],
      };
    }

    const raw = r.tracks ?? [];
    if (!raw.length) {
      failures.push(`${name}: tidak ada daftar track`);
      continue;
    }
    const tracks: ListedTrack[] = [];
    for (const t of raw) {
      const trackUrl = t.track_url || (t.id ? `https://open.spotify.com/track/${t.id}` : '');
      if (!trackUrl) continue;
      tracks.push({
        title: t.title || t.name || 'Spotify Track',
        artist: t.artist || (t.artists ? t.artists.join(', ') : ''),
        album: t.album ?? null,
        duration: durationOf(t),
        trackUrl,
      });
    }
    if (!tracks.length) {
      failures.push(`${name}: daftar track tanpa URL`);
      continue;
    }
    return { playlistName: r.title ?? null, tracks };
  }
  throw new Error(`scrapr gagal mengambil daftar track — ${failures.join('; ')}`);
}

/**
 * Resolve a Spotify URL (track/album/playlist) to verified mp3 URLs
 * without Spotify credentials or yt-dlp. Tracks that fail audio
 * resolution are skipped; throws when none succeed.
 */
export async function fetchSpotifyViaScrapr(url: string): Promise<ScraprSpotifyResultOut> {
  const type = detectType(url);
  const failures: string[] = [];

  // The list fetch is retried once: converter connections drop
  // intermittently, and a second attempt usually succeeds.
  let list: { playlistName: string | null; tracks: ListedTrack[] } | null = null;
  let lastErr: Error | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      list = await fetchTrackList(url, type, failures);
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  if (!list) throw lastErr ?? new Error('scrapr gagal mengambil daftar track');
  const { playlistName, tracks: listed } = list;

  const resolved: ScraprSpotifyTrack[] = [];
  for (let i = 0; i < listed.length; i += TRACK_CONCURRENCY) {
    const batch = listed.slice(i, i + TRACK_CONCURRENCY);
    const out = await Promise.all(
      batch.map(async (t): Promise<ScraprSpotifyTrack | null> => {
        if (t.audioUrl) {
          return {
            title: t.title,
            artist: t.artist,
            album: t.album,
            playlist: playlistName,
            duration: t.duration,
            audioUrl: t.audioUrl,
          };
        }
        const one = await resolveSingleTrack(t.trackUrl, failures);
        if (!one) return null;
        return {
          title: one.title || t.title,
          artist: one.artist || t.artist,
          album: one.album ?? t.album,
          playlist: playlistName,
          duration: one.duration ?? t.duration,
          audioUrl: one.audioUrl,
        };
      }),
    );
    for (const o of out) if (o) resolved.push(o);
  }

  if (!resolved.length) {
    throw new Error(`scrapr gagal — ${failures.join('; ')}`);
  }
  return { type, tracks: resolved };
}
