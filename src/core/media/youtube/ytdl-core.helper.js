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

  // ytdl-core expects {name, value, domain, path, expires, secure, httpOnly}
  // which is exactly what parseNetscape() emits. Strip entries with empty
  // name/value just in case.
  const sanitized = cookieEntries
    .filter((c) => c && c.name && c.value)
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain || '.youtube.com',
      path: c.path || '/',
      secure: !!c.secure,
      httpOnly: !!c.httpOnly,
      expires: typeof c.expires === 'number' && c.expires > 0 ? c.expires * 1000 : undefined,
    }));

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

  const audioStream = ytdl.downloadFromInfo(meta.info, {
    agent,
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25, // 32MB \u2014 reduce stalls on large videos
  });

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
async function downloadMp4(videoUrl, outPath, agent, providedInfo) {
  const meta = providedInfo || (await getVideoMetadata(videoUrl, agent));
  const formats = meta.info?.formats || [];
  const muxedFormats = formats.filter((f) => f.hasVideo && f.hasAudio);

  if (muxedFormats.length > 0) {
    const stream = ytdl.downloadFromInfo(meta.info, {
      agent,
      filter: 'videoandaudio',
      quality: 'highest',
      highWaterMark: 1 << 25,
    });
    await pipeStreamToFile(stream, outPath);
    return meta;
  }

  const videoFormats = formats.filter((f) => f.hasVideo && !f.hasAudio);
  const audioFormats = formats.filter((f) => f.hasAudio && !f.hasVideo);
  if (videoFormats.length === 0 || audioFormats.length === 0) {
    throw new Error('ytdl-core: no muxable video+audio formats available');
  }

  const videoStream = ytdl.downloadFromInfo(meta.info, {
    agent,
    filter: 'videoonly',
    quality: 'highestvideo',
    highWaterMark: 1 << 25,
  });
  const audioStream = ytdl.downloadFromInfo(meta.info, {
    agent,
    filter: 'audioonly',
    quality: 'highestaudio',
    highWaterMark: 1 << 25,
  });

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
