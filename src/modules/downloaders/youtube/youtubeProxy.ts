/**
 * YouTube audio resolver via proxy (last resort in the chain).
 *
 * Why this exists: YouTube hard-walls some videos for this server's
 * datacenter IP — the player request returns LOGIN_REQUIRED even
 * anonymously (no account involved), while the same video plays fine
 * from other IPs. A clean proxy IP plus a complete Innertube client
 * returns playable formats. Proven on the panel 2026-11-17:
 *  - 4 of 10 Webshare free proxies pass the player request.
 *  - Only the iOS client returns direct audio URLs; WEB and ANDROID
 *    return SABR formats with no static URL.
 *  - Player AND media must go through the SAME proxy: googlevideo
 *    answers 403 to the signed URL from the panel IP, 206 via proxy.
 *  - No PO token and no cookies are needed anywhere in this path.
 *
 * This step runs AFTER cobalt and scrapr in getYoutubeAudio, so proxy
 * bandwidth (1 GB/month on the free tier) is spent only on videos
 * nothing else can serve.
 *
 * Config: an untracked dotfile named `.proxy` in the app working
 * directory, one proxy URL per line. Proxy credentials live ONLY in
 * that file — never in chat, the repo, or logs (log lines mask every
 * proxy to host:port). No file, or an empty file, disables this step.
 *
 * youtubei.js is imported lazily: if the dependency is missing (the
 * panel launcher installs it on the restart after the deploy that
 * adds it), this step fails with a clear message instead of crashing
 * the whole app at startup.
 */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

const MAX_PROXY_ATTEMPTS = 5;
const SESSION_TIMEOUT_MS = 25_000;
const PLAYER_TIMEOUT_MS = 25_000;
const PROBE_TIMEOUT_MS = 15_000;

const PROBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface ProxyAudioResult {
  audioUrl: string;
  /** Index into the proxy list — the stream proxy must fetch the media
   *  through this same proxy (see header). Carried in the signed token. */
  proxyIndex: number;
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnail: string | null;
  duration: number | null;
  /** Real container of the bytes: 'opus' (audio/webm) or 'm4a'. */
  format: string;
  contentType: string;
  quality: string;
}

/** Proxy file location: YOUTUBE_PROXY_FILE wins, else `.proxy` in cwd. */
function proxyFilePath(): string {
  return process.env.YOUTUBE_PROXY_FILE || join(process.cwd(), '.proxy');
}

let cachedList: string[] | null = null;
let cachedMtimeMs = 0;

/** Proxy URLs, one per non-empty, non-comment line. Re-read when the
 *  file changes so proxies can be rotated without a restart. */
export function loadProxyList(): string[] {
  const path = proxyFilePath();
  try {
    const mtimeMs = statSync(path).mtimeMs;
    if (cachedList !== null && mtimeMs === cachedMtimeMs) return cachedList;
    const lines = readFileSync(path, 'utf8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    cachedList = lines;
    cachedMtimeMs = mtimeMs;
    return lines;
  } catch {
    cachedList = [];
    cachedMtimeMs = 0;
    return [];
  }
}

/** Safe log form: host:port + whether auth is present. Never the URL. */
export function maskProxy(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return `${u.hostname}:${u.port || '80'} (auth: ${u.username ? 'ya' : 'tidak'})`;
  } catch {
    return '(format tidak dikenal)';
  }
}

const dispatcherCache = new Map<string, ProxyAgent>();

/** Cached ProxyAgent for the proxy at `index`, or undefined when the
 *  index is out of range (proxy list changed since the URL was signed). */
export function getYoutubeProxyDispatcher(index: number): Dispatcher | undefined {
  const list = loadProxyList();
  const url = list[index];
  if (!url) return undefined;
  const cached = dispatcherCache.get(url);
  if (cached) return cached;
  const agent = new ProxyAgent(url);
  dispatcherCache.set(url, agent);
  return agent;
}

/** Normalise any HeadersInit shape to a plain record. Typed `unknown`
 *  because undici-types and the DOM lib disagree on HeadersInit. */
function headersToObject(h: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (typeof (h as Headers).forEach === 'function') {
    (h as Headers).forEach((v, k) => {
      out[k] = v;
    });
  } else if (Array.isArray(h)) {
    for (const pair of h) {
      const [k, v] = pair as [string?, string?];
      if (k) out[k] = v ?? '';
    }
  } else if (typeof h === 'object') {
    for (const [k, v] of Object.entries(h as Record<string, unknown>)) {
      out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
    }
  }
  return out;
}

/**
 * fetch shim that routes a youtubei.js session through a ProxyAgent.
 *
 * Two traps, both learned the hard way on the panel:
 *  1. youtubei.js passes a Request object from Node's realm, which the
 *     bundled undici rejects ("Failed to parse URL from [object
 *     Request]"). Normalise to a URL string + plain init.
 *  2. HTTPClient puts the FINAL body (context injected) in init.body;
 *     the body on the Request object is the raw one WITHOUT context.
 *     Per fetch semantics init.body wins — ignoring it made YouTube
 *     answer 400 "Precondition check failed".
 */
function makeProxiedFetch(agent: ProxyAgent): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
    if (typeof input === 'string' || input instanceof URL) {
      // `as any`: undici's RequestInit types diverge from the DOM lib's
      // (undici-types vs undici FormData variance) — same cast pattern
      // as randomsticker.service.ts. Runtime shim proven on the panel.
      return undiciFetch(input, { ...init, dispatcher: agent } as any);
    }
    const url = input.url;
    const method = input.method || 'GET';
    let body: RequestInit['body'] = init.body;
    if (body === undefined && method !== 'GET' && method !== 'HEAD' && input.body != null) {
      body = await input.arrayBuffer();
    }
    return undiciFetch(url, {
      method,
      headers: { ...headersToObject(input.headers), ...headersToObject(init.headers) },
      ...(body !== undefined ? { body } : {}),
      ...(init.signal ? { signal: init.signal } : {}),
      ...(init.redirect ? { redirect: init.redirect } : {}),
      dispatcher: agent,
    } as any);
  }) as typeof fetch;
}

/**
 * Verify the media URL actually streams through THIS proxy (1-byte
 * Range probe, same headers the stream proxy will send). A proxy can
 * pass the player request yet still be 403'd at googlevideo level —
 * that is exactly what happened on the first production deploy: the
 * resolver returned a player-OK pair whose media fetch 403'd, and the
 * /p/ link died with a silent 502. Only a pair that passes BOTH
 * stages is returned, so a minted token is guaranteed streamable.
 */
async function probeMediaUrl(audioUrl: string, agent: ProxyAgent): Promise<number> {
  const res = await undiciFetch(audioUrl, {
    headers: {
      Range: 'bytes=0-0',
      Referer: 'https://www.youtube.com/',
      'User-Agent': PROBE_UA,
    },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    dispatcher: agent,
  } as any);
  // Drain the 1-byte body so the socket can be reused.
  try {
    await res.arrayBuffer();
  } catch {
    /* ignore drain errors */
  }
  return res.status;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout ${ms}ms (${label})`)), ms),
    ),
  ]);
}

function mapFormat(mimeType: string): { format: string; contentType: string } {
  if (mimeType.startsWith('audio/webm')) return { format: 'opus', contentType: 'audio/webm' };
  if (mimeType.startsWith('audio/mp4')) return { format: 'm4a', contentType: 'audio/mp4' };
  if (mimeType.startsWith('audio/mpeg')) return { format: 'mp3', contentType: 'audio/mpeg' };
  return { format: 'opus', contentType: 'audio/webm' };
}

/**
 * Resolve audio for `videoId` through the proxy list (iOS client).
 * Tries proxies in file order until one passes BOTH stages: a playable
 * player response AND a media probe through the same proxy.
 * Throws an aggregated error naming every proxy that failed.
 */
export async function fetchViaProxyResolver(videoId: string): Promise<ProxyAudioResult> {
  const proxies = loadProxyList();
  if (proxies.length === 0) {
    throw new Error('file .proxy tidak ada atau kosong — resolver proxy nonaktif');
  }

  let Innertube: typeof import('youtubei.js').Innertube;
  let ClientType: typeof import('youtubei.js').ClientType;
  try {
    ({ Innertube, ClientType } = await import('youtubei.js'));
  } catch {
    throw new Error('youtubei.js belum terinstall — jalankan npm install lalu restart');
  }

  const failures: string[] = [];
  const attempts = proxies.slice(0, MAX_PROXY_ATTEMPTS);

  for (let i = 0; i < attempts.length; i++) {
    const proxyUrl = attempts[i] as string;
    const label = maskProxy(proxyUrl);
    try {
      const agent = new ProxyAgent(proxyUrl);
      const yt = await withTimeout(
        Innertube.create({ fetch: makeProxiedFetch(agent), client_type: ClientType.IOS }),
        SESSION_TIMEOUT_MS,
        'session',
      );
      const info = await withTimeout(yt.getBasicInfo(videoId), PLAYER_TIMEOUT_MS, 'player');
      const status = info.playability_status?.status;
      if (status !== 'OK') {
        failures.push(`${label}: playability=${status || '(tidak ada)'}`);
        continue;
      }
      const audio = (info.streaming_data?.adaptive_formats ?? [])
        .filter((f) => f.mime_type.startsWith('audio/') && typeof f.url === 'string')
        .sort((a, b) => b.bitrate - a.bitrate)[0];
      if (!audio?.url) {
        failures.push(`${label}: tidak ada format audio ber-URL (SABR?)`);
        continue;
      }
      // Stage 2: the media itself must stream through THIS proxy.
      // Player-OK does not imply media-OK (googlevideo trusts IPs
      // independently — see probeMediaUrl).
      let probeStatus: number;
      try {
        probeStatus = await probeMediaUrl(audio.url, agent);
      } catch (err) {
        failures.push(
          `${label}: probe media gagal: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160),
        );
        continue;
      }
      if (probeStatus !== 200 && probeStatus !== 206) {
        failures.push(`${label}: probe media HTTP ${probeStatus}`);
        continue;
      }
      const { format, contentType } = mapFormat(audio.mime_type);
      const basic = info.basic_info;
      const thumbnails = basic.thumbnail ?? [];
      const largest = [...thumbnails].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
      return {
        audioUrl: audio.url,
        proxyIndex: i,
        title: basic.title || 'YouTube Audio',
        authorName: basic.channel?.name || basic.author || '',
        authorUrl: basic.channel?.url || '',
        thumbnail: largest?.url || null,
        duration: basic.duration ?? null,
        format,
        contentType,
        quality: `${Math.round(audio.bitrate / 1000)}kbps`,
      };
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 160));
    }
  }

  throw new Error(`semua proxy gagal — ${failures.join('; ')}`);
}
