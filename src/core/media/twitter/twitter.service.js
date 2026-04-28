const axios = require('axios');
const youtubeDl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');

const VX_BASE = 'https://api.vxtwitter.com';
const FX_BASE = 'https://api.fxtwitter.com';
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Extract the numeric tweet ID from any twitter/x URL shape we accept.
 * Returns null if the URL doesn't contain a `/status/<digits>` segment.
 */
function extractTweetId(url) {
  const match = String(url).match(/\/status\/(\d{6,25})/);
  return match ? match[1] : null;
}

function normaliseFromVx(payload, sourceUrl) {
  const media = (payload.media_extended || []).map((m) => {
    const entry = {
      type: m.type === 'video' ? 'video' : m.type === 'gif' ? 'gif' : 'image',
      url: m.url,
    };
    if (m.size?.width) entry.width = m.size.width;
    if (m.size?.height) entry.height = m.size.height;
    if (m.duration_millis) entry.duration = m.duration_millis / 1000;
    if (m.thumbnail_url && entry.type !== 'image') entry.thumbnail = m.thumbnail_url;
    return entry;
  });

  return {
    source: 'vxtwitter',
    url: payload.tweetURL || sourceUrl,
    title: payload.text || '',
    author: {
      name: payload.user_name,
      username: payload.user_screen_name,
      avatar: payload.user_profile_image_url,
    },
    stats: {
      likes: payload.likes,
      retweets: payload.retweets,
      replies: payload.replies,
    },
    media,
    count: media.length,
    publishedAt: payload.date_epoch ? new Date(payload.date_epoch * 1000).toISOString() : null,
  };
}

function normaliseFromFx(payload, sourceUrl) {
  const tweet = payload.tweet || {};
  const mediaList = [
    ...(tweet.media?.photos || []).map((p) => ({
      type: 'image',
      url: p.url,
      width: p.width,
      height: p.height,
    })),
    ...(tweet.media?.videos || []).map((v) => ({
      type: v.type === 'gif' ? 'gif' : 'video',
      url: v.url,
      width: v.width,
      height: v.height,
      duration: v.duration,
      thumbnail: v.thumbnail_url,
    })),
  ];

  return {
    source: 'fxtwitter',
    url: tweet.url || sourceUrl,
    title: tweet.text || '',
    author: {
      name: tweet.author?.name,
      username: tweet.author?.screen_name,
      avatar: tweet.author?.avatar_url,
    },
    stats: {
      likes: tweet.likes,
      retweets: tweet.retweets,
      replies: tweet.replies,
    },
    media: mediaList,
    count: mediaList.length,
    publishedAt: tweet.created_timestamp
      ? new Date(tweet.created_timestamp * 1000).toISOString()
      : null,
  };
}

async function tryVx(tweetId, sourceUrl) {
  const res = await axios.get(`${VX_BASE}/Twitter/status/${tweetId}`, {
    timeout: FETCH_TIMEOUT_MS,
    validateStatus: (s) => s < 500,
  });
  if (res.status !== 200) throw new AppError(`vxtwitter HTTP ${res.status}`, 502);
  if (!res.data || !res.data.hasMedia) throw new NotFoundError('Tweet has no downloadable media');
  return normaliseFromVx(res.data, sourceUrl);
}

async function tryFx(tweetId, sourceUrl) {
  const res = await axios.get(`${FX_BASE}/status/${tweetId}`, {
    timeout: FETCH_TIMEOUT_MS,
    validateStatus: (s) => s < 500,
  });
  if (res.status !== 200) throw new AppError(`fxtwitter HTTP ${res.status}`, 502);
  const tweet = res.data?.tweet;
  if (!tweet) throw new NotFoundError('Tweet not found');
  const hasMedia = (tweet.media?.photos?.length || 0) + (tweet.media?.videos?.length || 0) > 0;
  if (!hasMedia) throw new NotFoundError('Tweet has no downloadable media');
  return normaliseFromFx(res.data, sourceUrl);
}

/**
 * yt-dlp final fallback. Only video tweets are recoverable here — image-only
 * tweets aren't supported by yt-dlp's twitter extractor. Returns one media
 * entry (the muxed mp4) without per-photo enumeration.
 */
async function tryYtDlp(sourceUrl) {
  const info = await youtubeDl(sourceUrl, {
    dumpSingleJson: true,
    noWarnings: true,
    noCheckCertificate: true,
    preferFreeFormats: true,
    addHeader: ['referer:twitter.com', 'user-agent:Mozilla/5.0'],
  });

  if (!info || !info.url) throw new NotFoundError('yt-dlp returned no media');

  return {
    source: 'yt-dlp',
    url: info.webpage_url || sourceUrl,
    title: info.title || info.description || '',
    author: {
      name: info.uploader,
      username: info.uploader_id,
      avatar: null,
    },
    stats: {
      likes: info.like_count,
      retweets: info.repost_count,
      replies: info.comment_count,
    },
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
    publishedAt: info.upload_date
      ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}`
      : null,
  };
}

/**
 * Twitter / X downloader with three-tier fallback. vxtwitter and fxtwitter
 * are public mirror APIs (no auth, no rate limit annoying enough to block
 * a single request) that already do the heavy lifting of resolving guest
 * tokens. yt-dlp is reserved as a last-resort for video tweets when both
 * mirrors are down.
 */
async function download(url) {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    throw new AppError('URL must contain a /status/<id> segment', 400);
  }

  logger.info(`[Twitter] Resolving tweet ${tweetId} (${url})`);

  try {
    const data = await tryVx(tweetId, url);
    logger.success(`[Twitter] Resolved via vxtwitter (${data.count} media)`);
    return data;
  } catch (err) {
    logger.warn(`[Twitter] vxtwitter failed: ${err.message}`);
  }

  try {
    const data = await tryFx(tweetId, url);
    logger.success(`[Twitter] Resolved via fxtwitter (${data.count} media)`);
    return data;
  } catch (err) {
    logger.warn(`[Twitter] fxtwitter failed: ${err.message}`);
  }

  try {
    const data = await tryYtDlp(url);
    logger.success(`[Twitter] Resolved via yt-dlp (video-only fallback)`);
    return data;
  } catch (err) {
    logger.error(`[Twitter] All tiers failed; last error: ${err.message}`);
    throw new NotFoundError('Could not resolve tweet via any provider');
  }
}

module.exports = { download, _internal: { extractTweetId, tryVx, tryFx, tryYtDlp } };
