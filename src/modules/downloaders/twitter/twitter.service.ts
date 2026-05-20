/**
 * Twitter/X downloader service.
 *
 * Strategy: use vxtwitter/fxtwitter JSON API (community maintained,
 * very reliable, no auth needed). These services convert twitter.com
 * URLs to direct media links.
 *
 * Primary: api.fxtwitter.com (most feature-complete)
 * Fallback: api.vxtwitter.com
 */

export interface TwitterResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  media: Array<{ type: 'video' | 'image' | 'gif'; url: string; quality?: string }>;
}

/**
 * Extract tweet ID from various Twitter/X URL formats.
 */
function extractTweetId(url: string): string | null {
  // Handles: twitter.com/user/status/123, x.com/user/status/123,
  // vxtwitter.com/..., fxtwitter.com/...
  const match = url.match(/(?:twitter\.com|x\.com|vxtwitter\.com|fxtwitter\.com)\/\w+\/status\/(\d+)/i);
  return match?.[1] ?? null;
}

/**
 * Fetch via fxtwitter API (most reliable as of 2025).
 */
async function fetchViaFxtwitter(tweetId: string, signal?: AbortSignal): Promise<TwitterResult> {
  // fxtwitter exposes a JSON API at /api/status/<id>
  // But easier: fetch the direct endpoint that returns combined JSON
  const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`, {
    headers: { 'User-Agent': 'Rex-API/3.0' },
    signal,
  });

  if (!res.ok) throw new Error(`fxtwitter returned ${res.status}`);
  const json = await res.json();

  if (!json.tweet) throw new Error('fxtwitter: no tweet data');
  const tweet = json.tweet;

  const media: TwitterResult['media'] = [];

  if (tweet.media?.videos?.length) {
    for (const v of tweet.media.videos) {
      media.push({
        type: 'video',
        url: v.url,
        quality: v.width && v.height ? `${v.height}p` : undefined,
      });
    }
  }

  if (tweet.media?.photos?.length) {
    for (const p of tweet.media.photos) {
      media.push({
        type: 'image',
        url: p.url,
      });
    }
  }

  // GIF (twitter serves as video)
  if (tweet.media?.gif) {
    media.push({
      type: 'gif',
      url: tweet.media.gif.url,
    });
  }

  // If fxtwitter combines all media differently
  if (media.length === 0 && tweet.media?.all?.length) {
    for (const item of tweet.media.all) {
      if (item.type === 'video' || item.type === 'gif') {
        media.push({ type: item.type, url: item.url, quality: item.height ? `${item.height}p` : undefined });
      } else if (item.type === 'photo') {
        media.push({ type: 'image', url: item.url });
      }
    }
  }

  return {
    title: tweet.text?.slice(0, 200) || 'Twitter Post',
    author: {
      name: tweet.author?.name || '',
      username: tweet.author?.screen_name || '',
    },
    thumbnail: tweet.media?.photos?.[0]?.url || tweet.media?.videos?.[0]?.thumbnail_url || null,
    media,
  };
}

/**
 * Fallback: vxtwitter API.
 */
async function fetchViaVxtwitter(tweetId: string, signal?: AbortSignal): Promise<TwitterResult> {
  const res = await fetch(`https://api.vxtwitter.com/Twitter/status/${tweetId}`, {
    headers: { 'User-Agent': 'Rex-API/3.0' },
    signal,
  });

  if (!res.ok) throw new Error(`vxtwitter returned ${res.status}`);
  const json = await res.json();

  const media: TwitterResult['media'] = [];

  if (json.media_extended?.length) {
    for (const m of json.media_extended) {
      if (m.type === 'video' || m.type === 'gif') {
        media.push({ type: m.type === 'gif' ? 'gif' : 'video', url: m.url, quality: m.size?.height ? `${m.size.height}p` : undefined });
      } else if (m.type === 'image') {
        media.push({ type: 'image', url: m.url });
      }
    }
  }

  return {
    title: json.text?.slice(0, 200) || 'Twitter Post',
    author: { name: json.user_name || '', username: json.user_screen_name || '' },
    thumbnail: json.media_extended?.[0]?.thumbnail_url || null,
    media,
  };
}

/**
 * Download Twitter/X post media.
 */
export async function downloadTwitter(url: string, signal?: AbortSignal): Promise<TwitterResult> {
  const tweetId = extractTweetId(url);
  if (!tweetId) throw new Error('Could not extract tweet ID from URL');

  // Try fxtwitter first, fallback to vxtwitter
  try {
    return await fetchViaFxtwitter(tweetId, signal);
  } catch {
    // Fallback
  }

  try {
    return await fetchViaVxtwitter(tweetId, signal);
  } catch (err: any) {
    throw new Error(`Twitter download failed: ${err.message}`);
  }
}
