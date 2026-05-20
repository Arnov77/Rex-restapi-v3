/**
 * Instagram downloader service.
 *
 * Strategy chain (tries in order, stops on first success):
 *   1. Instagram embed page scrape (no auth, works for public posts)
 *   2. Instagram oEmbed API (limited but reliable for metadata)
 *   3. Gramsnap API (community service)
 */

export interface InstagramResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Normalize Instagram URL — strip tracking params.
 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = '';
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Extract shortcode from Instagram URL.
 */
function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

/**
 * Method 1: Instagram embed page scrape.
 * Public posts expose media in their embed HTML.
 */
async function fetchViaEmbed(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error('Could not extract shortcode from URL');

  const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`Instagram embed returned ${res.status}`);
    const html = await res.text();

    const media: InstagramResult['media'] = [];

    // Extract video URLs
    const videoMatches = html.matchAll(/"video_url":"([^"]+)"/g);
    for (const m of videoMatches) {
      const videoUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (videoUrl.startsWith('http')) media.push({ type: 'video', url: videoUrl });
    }

    // Extract image URLs (display_url)
    const imageMatches = html.matchAll(/"display_url":"([^"]+)"/g);
    for (const m of imageMatches) {
      const imageUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (imageUrl.startsWith('http')) media.push({ type: 'image', url: imageUrl });
    }

    // Fallback: og:video / og:image meta tags
    if (media.length === 0) {
      const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/);
      if (ogVideo) media.push({ type: 'video', url: ogVideo[1].replace(/&amp;/g, '&') });

      const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogImage && !ogVideo) media.push({ type: 'image', url: ogImage[1].replace(/&amp;/g, '&') });
    }

    // Extract username
    const usernameMatch = html.match(/"username":"([^"]+)"/) ||
                          html.match(/class="UsernameText"[^>]*>([^<]+)</);
    const username = usernameMatch?.[1] || '';

    // Extract caption
    const captionMatch = html.match(/"caption":"([^"]{0,500})"/);
    const caption = captionMatch?.[1]?.replace(/\\n/g, ' ').trim() || 'Instagram Post';

    return {
      title: caption.slice(0, 200),
      author: { name: username, username },
      thumbnail: media.find(m => m.type === 'image')?.url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Method 2: Instagram oEmbed API.
 * Returns thumbnail + basic metadata. No video direct link but
 * gives us the thumbnail image at least.
 */
async function fetchViaOembed(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const oembedUrl = `https://www.instagram.com/oembed/?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { 'User-Agent': UA },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`oEmbed returned ${res.status}`);
    const data = await res.json();

    const media: InstagramResult['media'] = [];

    // oEmbed only gives us the thumbnail, but it's reliable
    if (data.thumbnail_url) {
      media.push({ type: 'image', url: data.thumbnail_url });
    }

    const authorName = data.author_name || '';

    return {
      title: (data.title || 'Instagram Post').slice(0, 200),
      author: { name: authorName, username: authorName },
      thumbnail: data.thumbnail_url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Method 3: Use gramsnap.com API (community service, usually up).
 */
async function fetchViaGramsnap(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch('https://api.gramsnap.com/media', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': UA,
      },
      body: JSON.stringify({ url }),
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`gramsnap returned ${res.status}`);
    const json = await res.json();

    const media: InstagramResult['media'] = [];

    if (Array.isArray(json.media)) {
      for (const item of json.media) {
        if (item.url) {
          media.push({
            type: item.type === 'video' ? 'video' : 'image',
            url: item.url,
          });
        }
      }
    } else if (json.url) {
      media.push({
        type: json.type === 'video' ? 'video' : 'image',
        url: json.url,
      });
    }

    return {
      title: (json.caption || 'Instagram Post').slice(0, 200),
      author: { name: json.username || '', username: json.username || '' },
      thumbnail: json.thumbnail || media.find(m => m.type === 'image')?.url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Download Instagram post/reel media.
 * Tries multiple methods with proper error isolation.
 */
export async function downloadInstagram(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const normalized = normalizeUrl(url);
  const errors: string[] = [];

  // Method 1: Embed scrape
  try {
    const result = await fetchViaEmbed(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('embed: no media found');
  } catch (err: any) {
    errors.push(`embed: ${err.message}`);
  }

  // Method 2: Gramsnap
  try {
    const result = await fetchViaGramsnap(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('gramsnap: no media found');
  } catch (err: any) {
    errors.push(`gramsnap: ${err.message}`);
  }

  // Method 3: oEmbed (at least get the image)
  try {
    const result = await fetchViaOembed(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('oembed: no media found');
  } catch (err: any) {
    errors.push(`oembed: ${err.message}`);
  }

  throw new Error(`Instagram download failed. Tried: ${errors.join('; ')}`);
}
