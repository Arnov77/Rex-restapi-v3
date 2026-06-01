/**
 * Facebook downloader service — VIDEO/REEL ONLY by design.
 *
 * Photos can be saved directly from Facebook, and login-gated scraping is
 * unreliable from a datacenter IP, so we don't chase them. Media comes from
 * cobalt (muxed video+audio); yt-dlp (-J, metadata only) enriches
 * title/author/thumbnail/duration.
 */

import { ytdlpGetInfo } from '../youtube/ytdlp.js';
import { AppError } from '@shared/errors.js';
import { loadEnv } from '../../../config/env.js';

export interface FacebookResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** cobalt error carrying its error code + HTTP status for the caller to map. */
class CobaltError extends Error {
  code?: string;
  httpStatus?: number;
  constructor(message: string, opts: { code?: string; httpStatus?: number } = {}) {
    super(message);
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
  }
}

/** Resolve fb.watch / /share/ links to the canonical URL, then strip query noise. */
async function normalizeUrl(url: string, signal?: AbortSignal): Promise<string> {
  let resolved = url;
  if (/fb\.watch|facebook\.com\/share\//i.test(url)) {
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'User-Agent': DESKTOP_UA, Accept: 'text/html,application/xhtml+xml' },
        signal,
      });
      resolved = res.url || url;
      const u = new URL(resolved);
      if (/login|checkpoint/i.test(u.pathname)) {
        const next = u.searchParams.get('next') || u.searchParams.get('u');
        if (next) resolved = decodeURIComponent(next);
      }
    } catch {
      resolved = url;
    }
  }
  try {
    const u = new URL(resolved);
    if (/(^|\.)facebook\.com$/i.test(u.hostname)) {
      const keep = new URLSearchParams();
      for (const k of ['fbid', 'set', 'v', 'id', 'story_fbid']) {
        const val = u.searchParams.get(k);
        if (val) keep.set(k, val);
      }
      u.search = keep.toString();
      resolved = u.toString();
    }
  } catch {
    /* ignore */
  }
  return resolved;
}

/** Decide video vs image from cobalt's filename ext (fallback: source URL). */
function cobaltIsVideo(filename: string | undefined, sourceUrl: string): boolean {
  const f = (filename || '').toLowerCase();
  if (/\.(mp4|mov|mkv|webm|m4v)$/.test(f)) return true;
  if (/\.(jpe?g|png|webp|gif|heic)$/.test(f)) return false;
  return /\/(watch|videos|reel|reels)\b/i.test(sourceUrl);
}

/** Media source: cobalt — muxed video+audio tunnel / picker. */
async function fetchViaCobalt(url: string, signal?: AbortSignal): Promise<FacebookResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const env = loadEnv();
    const res = await fetch(env.COBALT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ url }),
      signal: mergedSignal,
    });

    // Read the body even on non-2xx — cobalt returns its error code in a JSON
    // body on 400 (e.g. {"status":"error","error":{"code":"error.api.fetch.empty"}}).
    const rawBody = await res.text().catch(() => '');
    let json: any = {};
    try {
      json = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      /* non-JSON error page */
    }

    if (!res.ok || json.status === 'error') {
      const code: string | undefined = json?.error?.code;
      throw new CobaltError(code || `cobalt returned ${res.status}`, { code, httpStatus: res.status });
    }

    const media: FacebookResult['media'] = [];
    if (json.status === 'picker' && Array.isArray(json.picker)) {
      for (const item of json.picker) {
        if (!item?.url) continue;
        const isVideo = item.type === 'video' || item.type === 'gif';
        media.push({ type: isVideo ? 'video' : 'image', url: item.url });
      }
    } else if (json.url) {
      media.push({ type: cobaltIsVideo(json.filename, url) ? 'video' : 'image', url: json.url, quality: 'hd' });
    }

    return {
      title: 'Facebook Post',
      author: { name: '', username: '' },
      thumbnail: media.find((m) => m.type === 'image')?.url ?? null,
      duration: null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadFacebook(url: string, signal?: AbortSignal): Promise<FacebookResult> {
  const normalized = await normalizeUrl(url, signal);
  const metaPromise = ytdlpGetInfo(normalized).catch(() => null);

  let base: FacebookResult;
  try {
    base = await fetchViaCobalt(normalized, signal);
  } catch (err: any) {
    // cobalt couldn't extract a video. For Facebook this is almost always a
    // photo post (save directly) or a private/unavailable video — surface it
    // as a friendly 422 rather than a scary 502.
    const code: string | undefined = err?.code;
    const noVideo =
      err?.httpStatus === 400 ||
      (code && /fetch\.(empty|short|fail|critical)|content\.(post|media).*(unavailable|private)|link\.unsupported/i.test(code));

    if (noVideo) {
      throw new AppError(
        422,
        'FACEBOOK_NO_VIDEO',
        'No downloadable video found. This downloader supports Facebook videos/reels only — ' +
          'photos can be saved directly from Facebook. (A private or unavailable video also lands here.)',
      );
    }
    throw new AppError(502, 'FACEBOOK_DOWNLOAD_FAILED', `Could not download this Facebook media: ${err.message}`);
  }

  // Keep videos only (defensive — picker may include images).
  const videoMedia = base.media.filter((m) => m.type === 'video');
  if (videoMedia.length === 0) {
    throw new AppError(
      422,
      'FACEBOOK_NO_VIDEO',
      'No downloadable video found. This downloader supports Facebook videos/reels only — ' +
        'photos can be saved directly from Facebook.',
    );
  }
  base.media = videoMedia;

  const meta = await metaPromise;
  return {
    title: meta?.title && meta.title !== 'Untitled' ? meta.title : base.title,
    author: meta && (meta.author.name || meta.author.username) ? meta.author : base.author,
    thumbnail: meta?.thumbnail ?? base.thumbnail,
    duration: meta?.duration ?? base.duration,
    media: base.media,
  };
}
