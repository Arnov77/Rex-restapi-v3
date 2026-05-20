/**
 * YouTube downloader service.
 *
 * Strategy: use cobalt.tools API (community maintained, open source,
 * very reliable as of 2025). No auth needed, supports video + audio.
 *
 * Fallback: invidious instances (public YouTube API proxies).
 *
 * cobalt API docs: https://github.com/imputnet/cobalt
 */

export interface YoutubeResult {
  title: string;
  author: { name: string; username: string };
  thumbnail: string | null;
  duration: number | null;
  media: Array<{ type: 'video' | 'audio'; url: string; quality?: string }>;
}

/**
 * Extract video ID from various YouTube URL formats.
 */
function extractVideoId(url: string): string | null {
  // Standard: youtube.com/watch?v=ID
  const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watchMatch) return watchMatch[1];

  // Shortened: youtu.be/ID
  const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (shortMatch) return shortMatch[1];

  // Embed: youtube.com/embed/ID
  const embedMatch = url.match(/youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embedMatch) return embedMatch[1];

  // Shorts: youtube.com/shorts/ID
  const shortsMatch = url.match(/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/);
  if (shortsMatch) return shortsMatch[1];

  // Live: youtube.com/live/ID
  const liveMatch = url.match(/youtube\.com\/live\/([a-zA-Z0-9_-]{11})/);
  if (liveMatch) return liveMatch[1];

  return null;
}

/**
 * Primary method: cobalt.tools API.
 * Returns direct download links for video + audio.
 */
async function fetchViaCobalt(url: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const res = await fetch('https://api.cobalt.tools/api/json', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      url,
      vQuality: '720',
      filenamePattern: 'basic',
      isAudioOnly: false,
    }),
    signal,
  });

  if (!res.ok) throw new Error(`cobalt returned ${res.status}`);
  const json = await res.json();

  if (json.status === 'error') {
    throw new Error(json.text || 'cobalt: download failed');
  }

  const media: YoutubeResult['media'] = [];

  if (json.status === 'stream' || json.status === 'redirect') {
    // Single URL returned (video with audio muxed)
    if (json.url) {
      media.push({ type: 'video', url: json.url, quality: '720p' });
    }
  } else if (json.status === 'picker') {
    // Multiple options
    for (const item of json.picker || []) {
      if (item.url) {
        media.push({
          type: item.type === 'audio' ? 'audio' : 'video',
          url: item.url,
          quality: item.quality || undefined,
        });
      }
    }
  }

  // Also try to get audio-only
  try {
    const audioRes = await fetch('https://api.cobalt.tools/api/json', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        url,
        isAudioOnly: true,
        aFormat: 'mp3',
      }),
      signal,
    });

    if (audioRes.ok) {
      const audioJson = await audioRes.json();
      if ((audioJson.status === 'stream' || audioJson.status === 'redirect') && audioJson.url) {
        media.push({ type: 'audio', url: audioJson.url, quality: 'mp3' });
      }
    }
  } catch {
    // audio extraction is best-effort
  }

  return {
    title: 'YouTube Video',
    author: { name: '', username: '' },
    thumbnail: null,
    duration: null,
    media,
  };
}

/**
 * Fallback: use Invidious API to get video info + stream URLs.
 * Multiple public instances available.
 */
async function fetchViaInvidious(videoId: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const instances = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://y.com.sb',
    'https://invidious.nerdvpn.de',
  ];

  let lastErr: Error | null = null;

  for (const instance of instances) {
    try {
      const res = await fetch(`${instance}/api/v1/videos/${videoId}`, {
        headers: { 'Accept': 'application/json' },
        signal,
      });

      if (!res.ok) continue;
      const data = await res.json();

      const media: YoutubeResult['media'] = [];

      // Get adaptive formats (separate video/audio streams)
      if (data.adaptiveFormats?.length) {
        // Best video (prefer 720p or below to keep size reasonable)
        const videos = data.adaptiveFormats
          .filter((f: any) => f.type?.startsWith('video/') && f.url)
          .sort((a: any, b: any) => {
            const aH = parseInt(a.resolution?.replace('p', '') || '0');
            const bH = parseInt(b.resolution?.replace('p', '') || '0');
            return bH - aH;
          });

        // Pick best ≤720p, or fallback to lowest available
        const target = videos.find((v: any) => {
          const h = parseInt(v.resolution?.replace('p', '') || '9999');
          return h <= 720;
        }) || videos[videos.length - 1];

        if (target) {
          media.push({ type: 'video', url: target.url, quality: target.resolution || target.qualityLabel });
        }

        // Best audio
        const audio = data.adaptiveFormats.find((f: any) => f.type?.startsWith('audio/') && f.url);
        if (audio) {
          media.push({ type: 'audio', url: audio.url, quality: audio.bitrate ? `${Math.round(audio.bitrate / 1000)}kbps` : undefined });
        }
      }

      // Fallback to formatStreams (muxed video+audio)
      if (media.length === 0 && data.formatStreams?.length) {
        const best = data.formatStreams[data.formatStreams.length - 1];
        if (best?.url) {
          media.push({ type: 'video', url: best.url, quality: best.resolution || best.qualityLabel });
        }
      }

      const thumbnail = data.videoThumbnails?.find((t: any) => t.quality === 'maxresdefault')?.url
        || data.videoThumbnails?.[0]?.url
        || null;

      return {
        title: (data.title || 'YouTube Video').slice(0, 200),
        author: { name: data.author || '', username: data.authorId || '' },
        thumbnail,
        duration: data.lengthSeconds || null,
        media,
      };
    } catch (err: any) {
      lastErr = err;
      continue;
    }
  }

  throw lastErr || new Error('All Invidious instances failed');
}

/**
 * Download YouTube video metadata + stream URLs.
 */
export async function downloadYoutube(url: string, signal?: AbortSignal): Promise<YoutubeResult> {
  const videoId = extractVideoId(url);

  // Try cobalt first (best quality, most reliable)
  try {
    const result = await fetchViaCobalt(url, signal);
    if (result.media.length > 0) {
      // Enrich with metadata from Invidious if cobalt returned empty metadata
      if (videoId && result.title === 'YouTube Video') {
        try {
          const meta = await fetchViaInvidious(videoId, signal);
          result.title = meta.title;
          result.author = meta.author;
          result.thumbnail = meta.thumbnail;
          result.duration = meta.duration;
        } catch {
          // metadata enrichment is best-effort
        }
      }
      return result;
    }
  } catch {
    // fallback
  }

  // Fallback to Invidious (has both metadata and stream URLs)
  if (!videoId) throw new Error('Could not extract video ID from URL');

  try {
    return await fetchViaInvidious(videoId, signal);
  } catch (err: any) {
    throw new Error(`YouTube download failed: ${err.message}`);
  }
}
