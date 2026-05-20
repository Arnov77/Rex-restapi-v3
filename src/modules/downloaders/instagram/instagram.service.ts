/**
 * Instagram downloader service.
 *
 * Instagram aggressively blocks datacenter IPs from their API/embeds.
 * Strategy chain:
 *   1. cobalt.tools API — proxied service that handles IG's anti-bot
 *   2. Instagram embed page scrape (works if IP isn't blocked)
 *   3. Instagram GraphQL (rarely works from VPS IPs)
 */

export interface InstagramResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  media: Array<{ type: 'video' | 'image'; url: string; quality?: string }>;
}

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

/**
 * Normalize Instagram URL — strip tracking params.
 */
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

/**
 * Extract shortcode from Instagram URL.
 */
function extractShortcode(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);
  return match?.[1] ?? null;
}

/**
 * Method 1: cobalt.tools API.
 * Works from any IP — cobalt handles Instagram's anti-bot internally.
 */
async function fetchViaCobalt(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        url,
        filenamePattern: 'basic',
      }),
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`cobalt returned ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error('cobalt returned non-JSON response');
    }

    const json = await res.json();

    if (json.status === 'error') {
      throw new Error(json.text || 'cobalt: download failed');
    }

    const media: InstagramResult['media'] = [];

    if (json.status === 'stream' || json.status === 'redirect') {
      // Single media item
      if (json.url) {
        // Detect type from URL or default to video for reels
        const isVideo = /\.mp4|video/i.test(json.url) || url.includes('/reel');
        media.push({ type: isVideo ? 'video' : 'image', url: json.url });
      }
    } else if (json.status === 'picker') {
      // Multiple items (carousel)
      for (const item of json.picker || []) {
        if (item.url) {
          const isVideo = item.type === 'video' || /\.mp4|video/i.test(item.url);
          media.push({
            type: isVideo ? 'video' : 'image',
            url: item.url,
          });
        }
      }
    }

    return {
      title: 'Instagram Post',
      author: { name: '', username: '' },
      thumbnail: media.find(m => m.type === 'image')?.url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Method 2: Instagram embed page scrape.
 */
async function fetchViaEmbed(shortcode: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`embed returned ${res.status}`);
    const html = await res.text();

    const media: InstagramResult['media'] = [];

    // Extract video URLs
    const videoMatches = html.matchAll(/"video_url":"([^"]+)"/g);
    for (const m of videoMatches) {
      const videoUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (videoUrl.startsWith('http')) media.push({ type: 'video', url: videoUrl });
    }

    // Extract image URLs
    const imageMatches = html.matchAll(/"display_url":"([^"]+)"/g);
    for (const m of imageMatches) {
      const imageUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (imageUrl.startsWith('http')) media.push({ type: 'image', url: imageUrl });
    }

    // Fallback: og tags
    if (media.length === 0) {
      const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/);
      if (ogVideo) media.push({ type: 'video', url: ogVideo[1].replace(/&amp;/g, '&') });

      const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogImage && !ogVideo) media.push({ type: 'image', url: ogImage[1].replace(/&amp;/g, '&') });
    }

    const usernameMatch = html.match(/"username":"([^"]+)"/);
    const username = usernameMatch?.[1] || '';

    return {
      title: 'Instagram Post',
      author: { name: username, username },
      thumbnail: media.find(m => m.type === 'image')?.url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Method 3: Instagram GraphQL.
 */
async function fetchViaGraphQL(shortcode: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const variables = JSON.stringify({ shortcode });
    const url = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(variables)}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`GraphQL returned ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error('GraphQL returned HTML (login wall)');
    }

    const json = await res.json();
    const item = json?.data?.shortcode_media;
    if (!item) throw new Error('no shortcode_media in response');

    const media: InstagramResult['media'] = [];

    if (item.edge_sidecar_to_children?.edges) {
      for (const edge of item.edge_sidecar_to_children.edges) {
        const node = edge.node;
        if (node.is_video && node.video_url) {
          media.push({ type: 'video', url: node.video_url });
        } else if (node.display_url) {
          media.push({ type: 'image', url: node.display_url });
        }
      }
    } else if (item.is_video && item.video_url) {
      media.push({ type: 'video', url: item.video_url });
    } else if (item.display_url) {
      media.push({ type: 'image', url: item.display_url });
    }

    const caption = item.edge_media_to_caption?.edges?.[0]?.node?.text || 'Instagram Post';
    const username = item.owner?.username || '';

    return {
      title: caption.replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
      author: { name: item.owner?.full_name || username, username },
      thumbnail: item.display_url || null,
      media,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Download Instagram post/reel media.
 */
export async function downloadInstagram(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const normalized = normalizeUrl(url);
  const shortcode = extractShortcode(normalized);
  const errors: string[] = [];

  if (!shortcode) {
    throw new Error('Could not extract shortcode from Instagram URL. Supported: /p/CODE, /reel/CODE, /tv/CODE');
  }

  // Method 1: Cobalt (most reliable — bypasses IG's IP blocks)
  try {
    const result = await fetchViaCobalt(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('cobalt: no media returned');
  } catch (err: any) {
    errors.push(`cobalt: ${err.message}`);
  }

  // Method 2: Embed scrape
  try {
    const result = await fetchViaEmbed(shortcode, signal);
    if (result.media.length > 0) return result;
    errors.push('embed: no media found');
  } catch (err: any) {
    errors.push(`embed: ${err.message}`);
  }

  // Method 3: GraphQL (usually blocked on VPS IPs)
  try {
    const result = await fetchViaGraphQL(shortcode, signal);
    if (result.media.length > 0) return result;
    errors.push('graphql: no media found');
  } catch (err: any) {
    errors.push(`graphql: ${err.message}`);
  }

  throw new Error(`Instagram download failed. Tried: ${errors.join('; ')}`);
}
