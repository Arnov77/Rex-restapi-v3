/**
 * Instagram downloader service.
 *
 * Hybrid: cobalt for media (muxed video+audio / photo picker), yt-dlp (-J,
 * metadata only) for title/author/thumbnail. The embed/GraphQL scrapers send
 * an instagram.com cookie (from the same cookies.txt yt-dlp uses) to reach
 * login-gated posts when cobalt can't.
 */

import { ytdlpGetInfo } from '../youtube/ytdlp.js';
import { AppError } from '@shared/errors.js';
import { cookieHeaderFor } from '@shared/utils/netscapeCookies.js';
import { loadEnv } from '../../../config/env.js';

export interface InstagramResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/** Optional instagram.com cookie header from cookies.txt (empty when absent). */
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
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('cobalt returned non-JSON response');

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
      media.push({ type: cobaltIsVideo(json.filename, url) ? 'video' : 'image', url: json.url });
    }

    return {
      title: 'Instagram Post',
      author: { name: '', username: '' },
      thumbnail: media.find((m) => m.type === 'image')?.url ?? null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaEmbed(shortcode: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', ...igCookie() },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`embed returned ${res.status}`);
    const html = await res.text();

    const media: InstagramResult['media'] = [];
    for (const m of html.matchAll(/"video_url":"([^"]+)"/g)) {
      const videoUrl = m[1]!.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (videoUrl.startsWith('http')) media.push({ type: 'video', url: videoUrl });
    }
    for (const m of html.matchAll(/"display_url":"([^"]+)"/g)) {
      const imageUrl = m[1]!.replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (imageUrl.startsWith('http')) media.push({ type: 'image', url: imageUrl });
    }
    if (media.length === 0) {
      const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/);
      if (ogVideo) media.push({ type: 'video', url: ogVideo[1]!.replace(/&/g, '&') });
      const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogImage && !ogVideo) media.push({ type: 'image', url: ogImage[1]!.replace(/&amp;/g, '&') });
    }

    const username = html.match(/"username":"([^"]+)"/)?.[1] || '';
    return {
      title: 'Instagram Post',
      author: { name: username, username },
      thumbnail: media.find((m) => m.type === 'image')?.url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaGraphQL(shortcode: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const variables = JSON.stringify({ shortcode });
    const url = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(variables)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*', 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', ...igCookie() },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`GraphQL returned ${res.status}`);
    if (!(res.headers.get('content-type') || '').includes('json')) throw new Error('GraphQL returned HTML (login wall)');

    const json = (await res.json()) as any;
    const item = json?.data?.shortcode_media;
    if (!item) throw new Error('no shortcode_media in response');

    const media: InstagramResult['media'] = [];
    if (item.edge_sidecar_to_children?.edges) {
      for (const edge of item.edge_sidecar_to_children.edges) {
        const node = edge.node;
        if (node.is_video && node.video_url) media.push({ type: 'video', url: node.video_url });
        else if (node.display_url) media.push({ type: 'image', url: node.display_url });
      }
    } else if (item.is_video && item.video_url) {
      media.push({ type: 'video', url: item.video_url });
    } else if (item.display_url) {
      media.push({ type: 'image', url: item.display_url });
    }

    const caption = item.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Post';
    const username = item.owner?.username || '';
    return {
      title: caption.replace(/[\r]+/g, ' ').trim().slice(0, 200),
      author: { name: item.owner?.full_name || username, username },
      thumbnail: item.display_url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadInstagram(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const normalized = normalizeUrl(url);
  const shortcode = extractShortcode(normalized);
  const errors: string[] = [];

  if (!shortcode) {
    throw new AppError(400, 'INVALID_INSTAGRAM_URL', 'Could not parse the Instagram URL. Supported: /p/CODE, /reel/CODE, /tv/CODE');
  }

  const metaPromise = ytdlpGetInfo(normalized).catch(() => null);

  let base: InstagramResult | null = null;
  try {
    const r = await fetchViaCobalt(normalized, signal);
    if (r.media.length > 0) base = r; else errors.push('cobalt: no media returned');
  } catch (err: any) { errors.push(`cobalt: ${err.message}`); }

  if (!base) {
    try {
      const r = await fetchViaEmbed(shortcode, signal);
      if (r.media.length > 0) base = r; else errors.push('embed: no media found');
    } catch (err: any) { errors.push(`embed: ${err.message}`); }
  }

  if (!base) {
    try {
      const r = await fetchViaGraphQL(shortcode, signal);
      if (r.media.length > 0) base = r; else errors.push('graphql: no media found');
    } catch (err: any) { errors.push(`graphql: ${err.message}`); }
  }

  if (!base) {
    throw new AppError(502, 'INSTAGRAM_DOWNLOAD_FAILED', `Could not download this Instagram media. Tried: ${errors.join('; ')}`);
  }

  const meta = await metaPromise;
  return {
    title: meta?.title && meta.title !== 'Untitled' ? meta.title : base.title,
    author: meta && (meta.author.name || meta.author.username) ? meta.author : base.author,
    thumbnail: meta?.thumbnail ?? base.thumbnail,
    media: base.media,
  };
}
