/**
 * Facebook downloader service.
 *
 * Strategy chain:
 *   1. cobalt API (self-hosted) — most reliable, handles FB's anti-bot
 *   2. Direct page scrape (mobile UA) — parse video_url from page HTML
 *   3. Desktop page scrape fallback
 */

import { loadEnv } from '../../../config/env.js';

export interface FacebookResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 12; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Normalize Facebook URL — resolve fb.watch shortlinks.
 */
async function normalizeUrl(url: string, signal?: AbortSignal): Promise<string> {
  // fb.watch shortlinks redirect to the full URL
  if (/fb\.watch/i.test(url)) {
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: { 'User-Agent': DESKTOP_UA },
      signal,
    });
    return res.url;
  }
  return url;
}

/**
 * Primary method: scrape the mobile version of the Facebook page.
 * Mobile pages expose video URLs more readily than desktop.
 */
async function fetchViaMobileScrape(url: string, signal?: AbortSignal): Promise<FacebookResult> {
  // Convert to mobile URL
  const mobileUrl = url.replace('www.facebook.com', 'm.facebook.com');

  const res = await fetch(mobileUrl, {
    headers: {
      'User-Agent': MOBILE_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
    signal,
  });

  if (!res.ok) throw new Error(`Facebook returned ${res.status}`);
  const html = await res.text();

  const media: FacebookResult['media'] = [];

  // Look for HD video URL
  const hdMatch = html.match(/browser_native_hd_url":"([^"]+)"/);
  if (hdMatch) {
    const hdUrl = hdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
    media.push({ type: 'video', url: decodeURIComponent(hdUrl), quality: 'hd' });
  }

  // Look for SD video URL
  const sdMatch = html.match(/browser_native_sd_url":"([^"]+)"/);
  if (sdMatch) {
    const sdUrl = sdMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
    media.push({ type: 'video', url: decodeURIComponent(sdUrl), quality: 'sd' });
  }

  // Alternative patterns
  if (media.length === 0) {
    const playableMatch = html.match(/playable_url(?:_quality_hd)?":"([^"]+)"/g);
    if (playableMatch) {
      for (const m of playableMatch) {
        const urlMatch = m.match(/:"([^"]+)"/);
        if (urlMatch) {
          const videoUrl = urlMatch[1].replace(/\\u0025/g, '%').replace(/\\\//g, '/').replace(/\\u0026/g, '&');
          const quality = m.includes('hd') ? 'hd' : 'sd';
          media.push({ type: 'video', url: decodeURIComponent(videoUrl), quality });
        }
      }
    }
  }

  // Look for images in non-video posts
  if (media.length === 0) {
    const imgMatches = html.matchAll(/data-src="(https:\/\/[^"]*?scontent[^"]+)"/g);
    for (const m of imgMatches) {
      const imgUrl = m[1].replace(/&amp;/g, '&');
      media.push({ type: 'image', url: imgUrl });
    }
  }

  // Extract title
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.replace(/ \| Facebook$/, '').trim() || 'Facebook Post';

  // Extract author
  const authorMatch = html.match(/"ownerName":"([^"]+)"/);
  const authorName = authorMatch?.[1] || '';

  // Extract duration if available
  const durationMatch = html.match(/"playable_duration_in_ms":(\d+)/);
  const duration = durationMatch ? Math.round(Number(durationMatch[1]) / 1000) : null;

  // Thumbnail
  const thumbMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  const thumbnail = thumbMatch?.[1]?.replace(/&amp;/g, '&') || null;

  return {
    title: title.slice(0, 200),
    author: { name: authorName, username: '' },
    thumbnail,
    duration,
    media,
  };
}

/**
 * Fallback: use an alternative scraping pattern with the desktop page
 * looking for video data in embedded JSON.
 */
async function fetchViaDesktopScrape(url: string, signal?: AbortSignal): Promise<FacebookResult> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Fetch-Mode': 'navigate',
    },
    redirect: 'follow',
    signal,
  });

  if (!res.ok) throw new Error(`Facebook desktop returned ${res.status}`);
  const html = await res.text();

  const media: FacebookResult['media'] = [];

  // Try to find video URLs in the page scripts
  const patterns = [
    /hd_src:"([^"]+)"/,
    /sd_src:"([^"]+)"/,
    /"hd_src":"([^"]+)"/,
    /"sd_src":"([^"]+)"/,
    /hd_src_no_ratelimit:"([^"]+)"/,
    /sd_src_no_ratelimit:"([^"]+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const videoUrl = match[1].replace(/\\\//g, '/').replace(/\\u0026/g, '&');
      const quality = pattern.source.includes('hd') ? 'hd' : 'sd';
      // Avoid duplicates
      if (!media.some(m => m.quality === quality)) {
        media.push({ type: 'video', url: videoUrl, quality });
      }
    }
  }

  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = titleMatch?.[1]?.replace(/ \| Facebook$/, '').trim() || 'Facebook Post';

  const thumbMatch = html.match(/property="og:image"\s+content="([^"]+)"/);
  const thumbnail = thumbMatch?.[1]?.replace(/&amp;/g, '&') || null;

  return {
    title: title.slice(0, 200),
    author: { name: '', username: '' },
    thumbnail,
    duration: null,
    media,
  };
}

/**
 * Download Facebook video/image post.
 */
export async function downloadFacebook(url: string, signal?: AbortSignal): Promise<FacebookResult> {
  const normalized = await normalizeUrl(url, signal);
  const errors: string[] = [];

  // Method 1: Cobalt (most reliable)
  try {
    const env = loadEnv();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const mergedSignal = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;

    try {
      const res = await fetch(env.COBALT_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ url: normalized, videoQuality: '720', filenameStyle: 'basic' }),
        signal: mergedSignal,
      });

      if (!res.ok) throw new Error(`cobalt returned ${res.status}`);
      const json = await res.json();
      if (json.status === 'error') throw new Error(json.text || 'cobalt failed');

      const media: FacebookResult['media'] = [];
      if (json.status === 'stream' || json.status === 'redirect' || json.status === 'tunnel') {
        if (json.url) media.push({ type: 'video', url: json.url, quality: 'hd' });
      } else if (json.status === 'picker') {
        for (const item of json.picker || []) {
          if (item.url) {
            const isVideo = item.type === 'video' || /\.mp4|video/i.test(item.url);
            media.push({ type: isVideo ? 'video' : 'image', url: item.url });
          }
        }
      }
      if (media.length > 0) {
        return { title: json.filename || 'Facebook Post', author: { name: '', username: '' }, thumbnail: null, duration: null, media };
      }
      errors.push('cobalt: no media returned');
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: any) {
    errors.push(`cobalt: ${err.message}`);
  }

  // Method 2: Mobile scrape
  try {
    const result = await fetchViaMobileScrape(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('mobile: no media found');
  } catch (err: any) {
    errors.push(`mobile: ${err.message}`);
  }

  // Method 3: Desktop scrape
  try {
    const result = await fetchViaDesktopScrape(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('desktop: no media found');
  } catch (err: any) {
    errors.push(`desktop: ${err.message}`);
  }

  throw new Error(`Facebook download failed. Tried: ${errors.join('; ')}`);
}
