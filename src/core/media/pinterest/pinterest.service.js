const axios = require('axios');
const youtubeDl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');

const FETCH_TIMEOUT_MS = 12_000;
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Pinterest CDN serves the same image at multiple resolution prefixes
 * (/75x75_RS/, /236x/, /474x/, /736x/, /originals/). The originals prefix
 * is publicly addressable as long as the trailing path (hash + filename)
 * stays intact, so swapping is safe even when the og:image meta returns a
 * scaled-down 736x copy.
 */
function upgradePinimgUrl(url) {
  if (!url || !url.includes('i.pinimg.com')) return url;
  return url.replace(/\/(?:75x75_RS|140x140|236x|474x|550x|736x|1200x|originals)\//, '/originals/');
}

function extractMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const altRe = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${prop}["']`,
    'i'
  );
  return html.match(re)?.[1] || html.match(altRe)?.[1] || null;
}

function extractAllMeta(html, prop) {
  const re = new RegExp(
    `<meta[^>]+(?:name|property)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
    'gi'
  );
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      Accept: 'text/html,application/xhtml+xml',
    },
    validateStatus: (s) => s < 500,
  });
  if (res.status !== 200) {
    throw new AppError(`Pinterest HTTP ${res.status}`, res.status === 404 ? 404 : 502);
  }
  return { html: res.data, finalUrl: res.request?.res?.responseUrl || url };
}

/**
 * Pinterest server-renders inline mp4 URLs for video pins inside the HTML
 * body (specifically a JSON blob containing /videos/iht/720p/<hash>.mp4 and
 * /videos/iht/hls/<hash>.m3u8). Image pins never contain those URLs, so
 * presence of `v1.pinimg.com/videos/.../720p/...mp4` is a reliable
 * "this is a video pin" signal. og:video meta is unreliable on Pinterest.
 */
function extractVideoUrls(html) {
  const out = {};
  const mp4 = html.match(/https:\/\/v1?\.pinimg\.com\/videos\/iht\/720p\/[^"'\s]+\.mp4/);
  if (mp4) out.mp4 = mp4[0];
  const hls = html.match(/https:\/\/v1?\.pinimg\.com\/videos\/iht\/hls\/[^"'\s]+\.m3u8/);
  if (hls) out.hls = hls[0];
  return out;
}

/**
 * Resolve a Pinterest pin via inline HTML scrape. OG meta tags give us the
 * cover image / title / description for every pin; for video pins we also
 * extract the inline mp4 URL Pinterest embeds in a JSON blob (og:video meta
 * is unreliable — it's frequently absent even when the pin IS a video).
 *
 * Single HTTP roundtrip — no headless browser, no API auth, no CSRF.
 */
async function tryOpenGraph(url) {
  const { html, finalUrl } = await fetchHtml(url);

  const ogImage = extractMeta(html, 'og:image');
  const ogTitle = extractMeta(html, 'og:title');
  const ogDescription = extractMeta(html, 'og:description');
  const width = extractMeta(html, 'og:image:width');
  const height = extractMeta(html, 'og:image:height');

  const videoUrls = extractVideoUrls(html);

  if (!ogImage && !videoUrls.mp4) {
    throw new NotFoundError('Pin has no OpenGraph media tags');
  }

  const media = [];

  if (videoUrls.mp4) {
    media.push({
      type: 'video',
      url: videoUrls.mp4,
      hls: videoUrls.hls || null,
      thumbnail: ogImage ? upgradePinimgUrl(ogImage) : null,
    });
  } else if (ogImage) {
    media.push({
      type: 'image',
      url: upgradePinimgUrl(ogImage),
      width: width ? Number(width) : null,
      height: height ? Number(height) : null,
    });

    const extras = extractAllMeta(html, 'og:image').slice(1);
    for (const extraUrl of extras) {
      const upgraded = upgradePinimgUrl(extraUrl);
      if (!media.some((m) => m.url === upgraded)) {
        media.push({ type: 'image', url: upgraded });
      }
    }
  }

  return {
    source: 'opengraph',
    url: finalUrl,
    title: ogTitle || '',
    description: ogDescription || '',
    media,
    count: media.length,
  };
}

async function tryYtDlp(url) {
  const info = await youtubeDl(url, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificate: true,
    addHeader: ['user-agent:Mozilla/5.0', 'referer:https://www.pinterest.com/'],
  });

  if (!info || !info.url) throw new NotFoundError('yt-dlp returned no media');

  return {
    source: 'yt-dlp',
    url: info.webpage_url || url,
    title: info.title || '',
    description: info.description || '',
    media: [
      {
        type: 'video',
        url: info.url,
        width: info.width,
        height: info.height,
        duration: info.duration,
        thumbnail: info.thumbnail,
      },
    ],
    count: 1,
  };
}

/**
 * Pinterest pin downloader. OpenGraph scrape is the primary path because
 * Pinterest server-renders og:* meta tags for every pin (image or video)
 * even when the rest of the page is client-side hydrated. yt-dlp covers
 * video pins where og:video is missing or sub-quality.
 */
async function download(url) {
  logger.info(`[Pinterest] Resolving pin: ${url}`);

  try {
    const data = await tryOpenGraph(url);
    logger.success(`[Pinterest] Resolved via OpenGraph (${data.count} media)`);
    return data;
  } catch (err) {
    logger.warn(`[Pinterest] OpenGraph failed: ${err.message}`);
  }

  try {
    const data = await tryYtDlp(url);
    logger.success(`[Pinterest] Resolved via yt-dlp`);
    return data;
  } catch (err) {
    logger.error(`[Pinterest] All tiers failed; last error: ${err.message}`);
    throw new NotFoundError('Could not resolve Pinterest pin');
  }
}

module.exports = {
  download,
  _internal: { upgradePinimgUrl, extractMeta, extractVideoUrls, tryOpenGraph, tryYtDlp },
};
