// Primary download path using @distube/ytdl-core. ytdl-core extracts
// player_response via JS execution that is NOT subject to yt-dlp's "downgraded
// player API JSON" path \u2014 in late 2025 this regularly returns full format
// lists for accounts that yt-dlp can only see storyboards for.
//
// Cookies flow through ytdl.createAgent(<cookieArray>) which builds a
// tough-cookie jar and HTTPS agent. No Cookie header is set manually.

const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const logger = require('../../../shared/utils/logger');

let cachedAgent = null;
let cachedCookieKey = null;

/**
 * Build (and cache) an ytdl-core agent from parsed Netscape cookies.
 * Returns null when no cookies are available — callers should still attempt
 * the download because ytdl-core works for many videos without auth.
 */
function getYtdlAgent(cookieEntries) {
  if (!Array.isArray(cookieEntries) || cookieEntries.length === 0) return null;
  // Cheap cache key: number of cookies + first cookie name. Cookies rarely
  // change at runtime; this avoids rebuilding the agent on every request.
  const cookieKey = `${cookieEntries.length}:${cookieEntries[0]?.name || ''}`;
  if (cachedAgent && cachedCookieKey === cookieKey) return cachedAgent;

  // tough-cookie (used by ytdl-core's agent) rejects any cookie whose declared
  // domain isn't a parent of the request URL. Real-world Netscape cookie
  // exports for YouTube include entries like `accounts.google.com` (Google
  // login session) which trip this check when sent to www.youtube.com.
  // Filter to youtube-only domains \u2014 the Google login cookies are not used by
  // ytdl-core's playback path anyway.
  const isYoutubeCookie = (c) => {
    const d = String(c.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    return d === 'youtube.com' || d.endsWith('.youtube.com') || d.endsWith('youtube-nocookie.com');
  };
  const sanitized = cookieEntries
    .filter((c) => c && c.name && c.value && isYoutubeCookie(c))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.youtube.com',
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires * 1000 : undefined,
    }));

  if (sanitized.length === 0) {
    logger.warn(
      '[YouTube] No youtube-domain cookies after filter \u2014 ytdl-core agent will be unauthenticated.'
    );
    return null;
  }

  cachedAgent = ytdl.createAgent(sanitized);
  cachedCookieKey = cookieKey;
  logger.info(`[YouTube] ytdl-core agent built with ${sanitized.length} cookies`);
  return cachedAgent;
}

/**
 * Probe a video's metadata via ytdl-core. Returns a normalized shape compatible
 * with the yt-dlp metadata used by the rest of the service.
 */
async function getVideoMetadata(videoUrl, agent) {
  const info = await ytdl.getInfo(videoUrl, agent ? { agent } : undefined);
  const v = info.videoDetails || {};
  return {
    info,
    title: v.title || '',
    duration: parseInt(v.lengthSeconds, 10) || 0,
    uploader: v.author?.name || v.ownerChannelName || '',
    thumbnail: v.thumbnails?.[v.thumbnails.length - 1]?.url || null,
  };
}

/**
 * Pipe a stream into a file. Resolves on 'finish'; rejects on 'error'.
 */
function pipeStreamToFile(stream, outPath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    let cleaned = false;
    const cleanup = (err) => {
      if (cleaned) return;
      cleaned = true;
      if (err) {
        ws.destroy();
        try {
          fs.unlinkSync(outPath);
        } catch {
          /* ignore */
        }
        reject(err);
      } else {
        resolve();
      }
    };
    stream.on('error', cleanup);
    ws.on('error', cleanup);
    ws.on('finish', () => cleanup());
    stream.pipe(ws);
  });
}

/**
 * Run a fluent-ffmpeg command as a Promise.
 */
function runFfmpeg(buildFn) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg();
    buildFn(cmd);
    cmd.on('error', reject).on('end', () => resolve());
    cmd.run();
  });
}

/**
 * Download an MP3 via ytdl-core + ffmpeg transcode.
 *   1. Get info to validate the video has audio formats.
 *   2. Stream audio-only at highest quality.
 *   3. Transcode with libmp3lame @ 192kbps.
 * Throws if no audio formats are available (PO-token gating still possible
 * even via ytdl-core for some videos, in which case we fall back to yt-dlp).
 */
async function downloadMp3(videoUrl, outPath, agent, providedInfo) {
  const meta = providedInfo || (await getVideoMetadata(videoUrl, agent));
  const formats = meta.info?.formats || [];
  const audioFormats = formats.filter((f) => f.hasAudio && !f.hasVideo);
  if (audioFormats.length === 0) {
    throw new Error('ytdl-core: no audio-only formats available');
  }

  const dlOpts = {
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25, // 32MB to reduce stalls on large videos
  };
  if (agent) dlOpts.agent = agent;
  const audioStream = ytdl.downloadFromInfo(meta.info, dlOpts);

  await new Promise((resolve, reject) => {
    let finished = false;
    audioStream.on('error', (err) => {
      if (finished) return;
      finished = true;
      reject(err);
    });

    ffmpeg(audioStream)
      .audioBitrate(192)
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('error', (err) => {
        if (finished) return;
        finished = true;
        try {
          fs.unlinkSync(outPath);
        } catch {
          /* ignore */
        }
        reject(err);
      })
      .on('end', () => {
        if (finished) return;
        finished = true;
        resolve();
      })
      .save(outPath);
  });

  return meta;
}

/**
 * Download an MP4 via ytdl-core. Prefers a single muxed (videoandaudio) stream
 * which avoids the merge step. Falls back to separate video+audio streams
 * muxed via ffmpeg when only adaptive formats are available (common for
 * resolutions above 360p).
 */
async function downloadMp4(videoUrl, outPath, agent, providedInfo, opts = {}) {
  const meta = providedInfo || (await getVideoMetadata(videoUrl, agent));
  const maxHeight = opts.maxHeight || null;
  const formats = meta.info?.formats || [];

  // Pick highest-quality format that satisfies (hasVideo / hasAudio) predicates
  // and -- when specified -- has height <= maxHeight.
  const pickBest = (predicate) =>
    formats
      .filter(predicate)
      .filter((f) => !maxHeight || (f.height && f.height <= maxHeight))
      .sort(
        (a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0)
      )[0] || null;

  // YouTube only ships muxed (videoandaudio) formats up to 360p. If the user
  // wants something higher, the adaptive video-only stream will out-resolve
  // the best muxed candidate -- prefer adaptive in that case, otherwise the
  // request for e.g. 1080p silently downgrades to 360p.
  const muxedFmt = pickBest((f) => f.hasVideo && f.hasAudio);
  const videoFmt = pickBest((f) => f.hasVideo && !f.hasAudio);
  const audioFmt = pickBest((f) => f.hasAudio && !f.hasVideo);
  const muxedHeight = muxedFmt?.height || 0;
  const adaptiveHeight = videoFmt?.height || 0;
  const useMuxed = muxedFmt && (!videoFmt || adaptiveHeight <= muxedHeight);

  if (useMuxed) {
    const muxedOpts = { quality: muxedFmt.itag, highWaterMark: 1 << 25 };
    if (agent) muxedOpts.agent = agent;
    const stream = ytdl.downloadFromInfo(meta.info, muxedOpts);
    await pipeStreamToFile(stream, outPath);
    return meta;
  }
  if (!videoFmt || !audioFmt) {
    throw new Error(
      `ytdl-core: no muxable video+audio formats${maxHeight ? ` <= ${maxHeight}p` : ''}`
    );
  }

  const videoOpts = { quality: videoFmt.itag, highWaterMark: 1 << 25 };
  const audioOpts = { quality: audioFmt.itag, highWaterMark: 1 << 25 };
  if (agent) {
    videoOpts.agent = agent;
    audioOpts.agent = agent;
  }
  const videoStream = ytdl.downloadFromInfo(meta.info, videoOpts);
  const audioStream = ytdl.downloadFromInfo(meta.info, audioOpts);

  await runFfmpeg((cmd) => {
    cmd
      .addInput(videoStream)
      .addInput(audioStream)
      .outputOptions(['-c:v copy', '-c:a aac', '-movflags +faststart'])
      .format('mp4')
      .save(outPath);
  });

  return meta;
}

module.exports = {
  getYtdlAgent,
  getVideoMetadata,
  downloadMp3,
  downloadMp4,
};
