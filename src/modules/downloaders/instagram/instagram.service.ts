/**
 * Instagram downloader service.
 *
 * Strategy: use igram.world API (community maintained, no auth needed).
 * Fallback: direct oembed + page scrape for __additionalDataLoaded.
 */

export interface InstagramResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Normalize Instagram URL — strip tracking params, ensure /p/ or /reel/ format.
 */
function normalizeUrl(url: string): string {
  const u = new URL(url);
  // Remove tracking query params
  u.search = '';
  return u.toString();
}

/**
 * Extract shortcode from Instagram URL.
 */
function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

/**
 * Primary method: use the public GraphQL embed endpoint.
 * Instagram embeds expose media data without authentication.
 */
async function fetchViaEmbed(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error('Could not extract shortcode from URL');

  // Try the public embed endpoint
  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const res = await fetch(embedUrl, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
    },
    signal,
  });

  if (!res.ok) throw new Error(`Instagram embed returned ${res.status}`);
  const html = await res.text();

  const media: InstagramResult['media'] = [];

  // Extract video URLs from embed HTML
  const videoMatches = html.matchAll(/\"video_url\":\"([^\"]+)\"/g);
  for (const m of videoMatches) {
    const videoUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    media.push({ type: 'video', url: videoUrl });
  }

  // Extract image URLs (display_url) from embed
  const imageMatches = html.matchAll(/\"display_url\":\"([^\"]+)\"/g);
  for (const m of imageMatches) {
    const imageUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    media.push({ type: 'image', url: imageUrl });
  }

  // If no structured data found, try og:video and og:image meta tags
  if (media.length === 0) {
    const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/);
    if (ogVideo) media.push({ type: 'video', url: ogVideo[1] });

    const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
    if (ogImage && !ogVideo) media.push({ type: 'image', url: ogImage[1] });
  }

  // Extract caption/title
  const captionMatch = html.match(/<div class="Caption"[^>]*>.*?<div class="CaptionUsername"[^>]*>.*?<a[^>]*>([^<]+)<\/a>.*?<div class="CaptionComment"[^>]*>.*?<span>(.+?)<\/span>/s);
  const username = captionMatch?.[1] || '';
  const caption = captionMatch?.[2]?.replace(/<[^>]+>/g, '').trim() || 'Instagram Post';

  // Alternative username extraction
  const usernameAlt = html.match(/"username":"([^"]+)"/)?.[1] || username;

  return {
    title: caption.slice(0, 200),
    author: { name: usernameAlt, username: usernameAlt },
    thumbnail: media.find(m => m.type === 'image')?.url || null,
    media,
  };
}

/**
 * Fallback: use saveig-style API
 */
async function fetchViaSaveig(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const res = await fetch('https://v3.saveig.app/api/ajaxSearch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': UA,
      'Origin': 'https://saveig.app',
      'Referer': 'https://saveig.app/',
    },
    body: `q=${encodeURIComponent(url)}&t=media&lang=en`,
    signal,
  });

  if (!res.ok) throw new Error(`saveig returned ${res.status}`);
  const json = await res.json();

  if (!json.data) throw new Error('saveig: no data');

  const media: InstagramResult['media'] = [];

  // Parse HTML response for download links
  const html: string = json.data;
  const videoLinks = html.matchAll(/href="([^"]+)"[^>]*>.*?Download Video/gi);
  for (const m of videoLinks) {
    media.push({ type: 'video', url: m[1] });
  }

  const imageLinks = html.matchAll(/<a[^>]+href="([^"]+\.jpg[^"]*)"[^>]*>/gi);
  for (const m of imageLinks) {
    if (!m[1].includes('thumbnail')) {
      media.push({ type: 'image', url: m[1] });
    }
  }

  return {
    title: 'Instagram Post',
    author: { name: '', username: '' },
    thumbnail: media.find(m => m.type === 'image')?.url || null,
    media,
  };
}

/**
 * Download Instagram post/reel media.
 */
export async function downloadInstagram(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const normalized = normalizeUrl(url);

  // Try embed method first
  try {
    const result = await fetchViaEmbed(normalized, signal);
    if (result.media.length > 0) return result;
  } catch {
    // fallback
  }

  // Fallback to saveig
  try {
    return await fetchViaSaveig(normalized, signal);
  } catch (err: any) {
    throw new Error(`Instagram download failed: ${err.message}`);
  }
}
