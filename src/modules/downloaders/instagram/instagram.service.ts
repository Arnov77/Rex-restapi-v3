/**
 * Instagram downloader service.
 *
 * Instagram heavily restricts scraping (login walls, rate limits).
 * Strategy chain (tries in order):
 *   1. Instagram GraphQL API (shortcode_media query — works for public posts)
 *   2. Instagram embed page scrape
 *   3. Instagram ?__a=1&__d=dis JSON endpoint
 *
 * NOTE: Instagram may block server IPs aggressively. If all methods fail,
 * the error message will detail which methods were tried and why they failed.
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
    // Ensure trailing slash for consistency
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
 * Method 1: Instagram GraphQL API.
 * Uses the public graphql endpoint with query_hash for shortcode_media.
 */
async function fetchViaGraphQL(shortcode: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    // Instagram's GraphQL endpoint for individual posts
    const variables = JSON.stringify({ shortcode });
    const url = `https://www.instagram.com/graphql/query/?query_hash=b3055c01b4b222b8a47dc12b090e4e64&variables=${encodeURIComponent(variables)}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`GraphQL returned ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      const text = await res.text();
      throw new Error(`GraphQL returned HTML (likely login wall): ${text.slice(0, 100)}`);
    }

    const json = await res.json();
    const item = json?.data?.shortcode_media;
    if (!item) throw new Error('GraphQL: no shortcode_media in response');

    const media: InstagramResult['media'] = [];

    // Handle carousel (sidecar)
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

    // Extract image URLs (display_url)
    const imageMatches = html.matchAll(/"display_url":"([^"]+)"/g);
    for (const m of imageMatches) {
      const imageUrl = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (imageUrl.startsWith('http')) media.push({ type: 'image', url: imageUrl });
    }

    // Fallback: og:video / og:image
    if (media.length === 0) {
      const ogVideo = html.match(/property="og:video"\s+content="([^"]+)"/);
      if (ogVideo) media.push({ type: 'video', url: ogVideo[1].replace(/&amp;/g, '&') });

      const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/);
      if (ogImage && !ogVideo) media.push({ type: 'image', url: ogImage[1].replace(/&amp;/g, '&') });
    }

    // Username
    const usernameMatch = html.match(/"username":"([^"]+)"/) ||
                          html.match(/class="UsernameText"[^>]*>([^<]+)</);
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
 * Method 3: Instagram ?__a=1&__d=dis JSON endpoint.
 * Sometimes still works for public posts.
 */
async function fetchViaJsonEndpoint(url: string, signal?: AbortSignal): Promise<InstagramResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  const mergedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const jsonUrl = url.replace(/\/$/, '') + '/?__a=1&__d=dis';
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: mergedSignal,
    });

    if (!res.ok) throw new Error(`JSON endpoint returned ${res.status}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      throw new Error('JSON endpoint returned HTML (login wall)');
    }

    const json = await res.json();
    const items = json?.items || json?.graphql?.shortcode_media;

    const media: InstagramResult['media'] = [];

    if (Array.isArray(items) && items.length > 0) {
      const item = items[0];
      // Carousel
      if (item.carousel_media) {
        for (const cm of item.carousel_media) {
          if (cm.video_versions?.length) {
            media.push({ type: 'video', url: cm.video_versions[0].url });
          } else if (cm.image_versions2?.candidates?.length) {
            media.push({ type: 'image', url: cm.image_versions2.candidates[0].url });
          }
        }
      } else if (item.video_versions?.length) {
        media.push({ type: 'video', url: item.video_versions[0].url });
      } else if (item.image_versions2?.candidates?.length) {
        media.push({ type: 'image', url: item.image_versions2.candidates[0].url });
      }

      const username = item.user?.username || '';
      const caption = item.caption?.text || 'Instagram Post';

      return {
        title: caption.replace(/[\r\n]+/g, ' ').trim().slice(0, 200),
        author: { name: item.user?.full_name || username, username },
        thumbnail: item.image_versions2?.candidates?.[0]?.url || null,
        media,
      };
    }

    // GraphQL format
    if (items && !Array.isArray(items)) {
      const item = items;
      if (item.is_video && item.video_url) {
        media.push({ type: 'video', url: item.video_url });
      } else if (item.display_url) {
        media.push({ type: 'image', url: item.display_url });
      }

      return {
        title: 'Instagram Post',
        author: { name: item.owner?.username || '', username: item.owner?.username || '' },
        thumbnail: item.display_url || null,
        media,
      };
    }

    throw new Error('JSON endpoint: unexpected response structure');
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
    throw new Error('Could not extract shortcode from Instagram URL. Supported formats: /p/CODE, /reel/CODE, /tv/CODE');
  }

  // Method 1: GraphQL
  try {
    const result = await fetchViaGraphQL(shortcode, signal);
    if (result.media.length > 0) return result;
    errors.push('graphql: no media found');
  } catch (err: any) {
    errors.push(`graphql: ${err.message}`);
  }

  // Method 2: Embed
  try {
    const result = await fetchViaEmbed(shortcode, signal);
    if (result.media.length > 0) return result;
    errors.push('embed: no media found');
  } catch (err: any) {
    errors.push(`embed: ${err.message}`);
  }

  // Method 3: JSON endpoint
  try {
    const result = await fetchViaJsonEndpoint(normalized, signal);
    if (result.media.length > 0) return result;
    errors.push('json: no media found');
  } catch (err: any) {
    errors.push(`json: ${err.message}`);
  }

  throw new Error(`Instagram download failed. Tried: ${errors.join('; ')}`);
}
