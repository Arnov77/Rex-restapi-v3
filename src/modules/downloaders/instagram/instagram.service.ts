/**
 * Instagram downloader service.
 *
 * Flow:
 *   Media    : cobalt → embed → (error)
 *   Metadata : oEmbed API (official, no login needed) — paralel dengan media fetch
 */

import { AppError } from '@shared/errors.js';
import { cookieHeaderFor } from '@shared/utils/netscapeCookies.js';
import { loadEnv } from '../../../config/env.js';

export interface InstagramResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function igCookie(): Record<string, string> {
  const cookie = cookieHeaderFor('instagram.com');
  return cookie ? { Cookie: cookie } : {};
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    if (!u.pathname.endsWith('/')) u.pathname += '/';
    return u.toString();
  } catch {
    return url;
  }
}

function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

function unesc(s: string): string {
  return s.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');
}

// ─── 1. oEmbed — metadata only (official, no login) ──────────────────────────

interface OembedMeta {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
}

async function fetchViaOembed(shortcode: string, signal?: AbortSignal): Promise<OembedMeta> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const postUrl = `https://www.instagram.com/p/${shortcode}/`;
    const url = `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(postUrl)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`oEmbed returned ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('json'))
      throw new Error('oEmbed returned non-JSON');

    const json = (await res.json()) as any;

    // author_name = username (e.g. "keyra.art_")
    // title       = caption
    // thumbnail_url = thumbnail
    const username = json.author_name?.trim() || '';
    const title = json.title?.trim().slice(0, 200) || '';
    const thumbnail = json.thumbnail_url || null;

    return { title, author: { name: username, username }, thumbnail };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── 2. Cobalt — media only ───────────────────────────────────────────────────

function cobaltIsVideo(filename: string | undefined, sourceUrl: string): boolean {
  const f = (filename || '').toLowerCase();
  if (/\.(mp4|mov|mkv|webm|m4v)$/.test(f)) return true;
  if (/\.(jpe?g|png|webp|gif|heic)$/.test(f)) return false;
  return /\/(reel|reels|tv)\//i.test(sourceUrl);
}

async function fetchViaCobalt(url: string, signal?: AbortSignal): Promise<InstagramResult> {
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

    if (!res.ok) throw new Error(`cobalt returned ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('json'))
      throw new Error('cobalt returned non-JSON');

    const json = (await res.json()) as any;
    if (json.status === 'error') throw new Error(json.error?.code || json.text || 'cobalt error');

    const media: InstagramResult['media'] = [];
    if (json.status === 'picker' && Array.isArray(json.picker)) {
      for (const item of json.picker) {
        if (!item?.url) continue;
        const isVideo = item.type === 'video' || item.type === 'gif';
        media.push({ type: isVideo ? 'video' : 'image', url: item.url });
      }
    } else if (json.url) {
      media.push({
        type: cobaltIsVideo(json.filename, url) ? 'video' : 'image',
        url: json.url,
      });
    }

    return { title: '', author: { name: '', username: '' }, thumbnail: null, media };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── 3. Embed — media fallback ────────────────────────────────────────────────

async function fetchViaEmbed(shortcode: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': UA_MOBILE,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...igCookie(),
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`embed returned ${res.status}`);
    const html = await res.text();

    const media: InstagramResult['media'] = [];
    for (const m of html.matchAll(/"video_url":"([^"]+)"/g)) {
      const v = unesc(m[1]!);
      if (v.startsWith('http')) media.push({ type: 'video', url: v });
    }
    for (const m of html.matchAll(/"display_url":"([^"]+)"/g)) {
      const v = unesc(m[1]!);
      if (v.startsWith('http')) media.push({ type: 'image', url: v });
    }
    if (media.length === 0) {
      const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/);
      if (ogVideo) media.push({ type: 'video', url: unesc(ogVideo[1]!) });
      const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogImage && !ogVideo) media.push({ type: 'image', url: unesc(ogImage[1]!) });
    }

    return { title: '', author: { name: '', username: '' }, thumbnail: null, media };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function downloadInstagram(
  url: string,
  signal?: AbortSignal,
): Promise<InstagramResult> {
  const normalized = normalizeUrl(url);
  const shortcode = extractShortcode(normalized);
  const errors: string[] = [];

  if (!shortcode) {
    throw new AppError(
      400,
      'INVALID_INSTAGRAM_URL',
      'Could not parse the Instagram URL. Supported: /p/CODE, /reel/CODE, /tv/CODE',
    );
  }

  // oEmbed dan media fetch jalan paralel
  const oembedPromise = fetchViaOembed(shortcode, signal).catch(() => null);

  const mediaPromise = (async (): Promise<InstagramResult | null> => {
    // cobalt dulu
    try {
      const r = await fetchViaCobalt(normalized, signal);
      if (r.media.length > 0) return r;
      errors.push('cobalt: no media returned');
    } catch (err: any) {
      errors.push(`cobalt: ${err.message}`);
    }

    // embed fallback
    try {
      const r = await fetchViaEmbed(shortcode, signal);
      if (r.media.length > 0) return r;
      errors.push('embed: no media found');
    } catch (err: any) {
      errors.push(`embed: ${err.message}`);
    }

    return null;
  })();

  const [mediaResult, meta] = await Promise.all([mediaPromise, oembedPromise]);

  if (!mediaResult) {
    throw new AppError(
      502,
      'INSTAGRAM_DOWNLOAD_FAILED',
      `Could not download this Instagram media. Tried: ${errors.join('; ')}`,
    );
  }

  return {
    title: meta?.title || 'Instagram Post',
    author: meta?.author ?? { name: '', username: '' },
    thumbnail: meta?.thumbnail ?? mediaResult.thumbnail,
    media: mediaResult.media,
  };
}
