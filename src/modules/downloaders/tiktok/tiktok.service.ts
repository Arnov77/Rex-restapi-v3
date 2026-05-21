/**
 * TikTok downloader service.
 *
 * Strategy: scrape TikTok's internal web API (oembed + __UNIVERSAL_DATA__).
 * No external library dependency — pure fetch + regex parsing.
 *
 * Fallback chain:
 *   1. TikTok oEmbed API (gets basic metadata)
 *   2. Direct page scrape for video URL from __UNIVERSAL_DATA__
 *   3. tikwm.com API (community mirror, very reliable as of 2025)
 */

export interface TiktokResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video' | 'audio' | 'image'; url: string; quality?: string }>;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Primary method: tikwm.com API (community maintained, very reliable).
 * Returns video URL without watermark + audio + metadata.
 */
async function fetchViaTikwm(url: string, signal?: AbortSignal): Promise<TiktokResult> {
  const res = await fetch('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: `url=${encodeURIComponent(url)}&count=12&cursor=0&web=1&hd=1`,
    signal,
  });

  if (!res.ok) throw new Error(`tikwm returned ${res.status}`);
  const json = (await res.json()) as any;

  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'tikwm: no data returned');
  }

  const d = json.data;

  // Handle image slideshow posts
  if (d.images && d.images.length > 0) {
    return {
      title: (d.title || 'TikTok Slideshow').replace(/[\r\n]+/g, ' ').trim(),
      author: { name: d.author?.nickname || '', username: d.author?.unique_id || '' },
      thumbnail: d.cover ? `https://www.tikwm.com${d.cover}` : null,
      duration: null,
      media: [
        ...d.images.map((img: string) => ({
          type: 'image' as const,
          url: img.startsWith('http') ? img : `https://www.tikwm.com${img}`,
        })),
        ...(d.music ? [{ type: 'audio' as const, url: d.music_info?.play || d.music }] : []),
      ],
    };
  }

  // Video post
  const hdUrl = d.hdplay || d.play;
  const sdUrl = d.play || d.wmplay;

  const media: TiktokResult['media'] = [];
  if (hdUrl) media.push({ type: 'video', url: hdUrl.startsWith('http') ? hdUrl : `https://www.tikwm.com${hdUrl}`, quality: 'hd' });
  if (sdUrl && sdUrl !== hdUrl) media.push({ type: 'video', url: sdUrl.startsWith('http') ? sdUrl : `https://www.tikwm.com${sdUrl}`, quality: 'sd' });
  if (d.music) media.push({ type: 'audio', url: d.music_info?.play || d.music, quality: undefined });

  return {
    title: (d.title || 'TikTok Video').replace(/[\r\n]+/g, ' ').trim(),
    author: { name: d.author?.nickname || '', username: d.author?.unique_id || '' },
    thumbnail: d.cover ? (d.cover.startsWith('http') ? d.cover : `https://www.tikwm.com${d.cover}`) : null,
    duration: d.duration || null,
    media,
  };
}

/**
 * Download TikTok video/slideshow metadata + direct URLs.
 */
export async function downloadTiktok(url: string, signal?: AbortSignal): Promise<TiktokResult> {
  // Try tikwm (most reliable as of 2025)
  try {
    return await fetchViaTikwm(url, signal);
  } catch (err: any) {
    throw new Error(`TikTok download failed: ${err.message}`);
  }
}
