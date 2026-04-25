// PRIMARY YouTube download path using youtubei.js + auto-generated PO Token
// (via bgutils-js + jsdom). This is the only path that works for accounts
// enrolled in YouTube's strict PO Token enforcement.
//
// The first call lazily initializes:
//   1. A barebones Innertube instance to fetch a fresh visitorData
//   2. A jsdom DOM stamped onto globalThis (window/document) so BotGuard
//      can run YouTube's obfuscated JS challenge
//   3. BG.Challenge.create() + BG.PoToken.generate() to produce a real PO
//      token bound to the visitorData
//   4. A second Innertube instance with po_token + visitor_data + cookies
//
// The instance is cached for the process lifetime. PO tokens last several
// hours; we re-init on first failure after expiry.

const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { Readable } = require('stream');
const logger = require('../../../shared/utils/logger');
const { buildCookieHeader } = require('../../../shared/utils/cookies');

let cachedYt = null;
let cachedCookieKey = null;
let initInFlight = null;
let domInstalled = false;

// Restrict cookie scope for youtubei.js to YouTube domains only. Same reason
// as ytdl-core: tough-cookie / strict matching trips on accounts.google.com.
function buildYouTubeCookieString(cookieEntries) {
  if (!Array.isArray(cookieEntries) || cookieEntries.length === 0) return '';
  const filtered = cookieEntries.filter((c) => {
    const d = String(c?.domain || '')
      .replace(/^\./, '')
      .toLowerCase();
    return d === 'youtube.com' || d.endsWith('.youtube.com') || d.endsWith('youtube-nocookie.com');
  });
  return buildCookieHeader(filtered, /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i);
}

async function installJsdom() {
  if (domInstalled) return;
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM();
  // BotGuard's interpreter expects a browser-like globalThis. We stamp the
  // jsdom window/document onto Node's global. This is global pollution but
  // it's the documented approach in BgUtils and youtubei.js examples.
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  domInstalled = true;
}

async function buildInstance(cookieEntries) {
  await installJsdom();
  const ytjs = await import('youtubei.js');
  const { Innertube, UniversalCache, Platform, Log } = ytjs;
  const { BG } = await import('bgutils-js');

  // Quiet upstream parser warnings ("VideoDescriptionYouchatSectionView not
  // found", "Unable to find matching run for attachment run", etc.). They
  // come from new YouTube response fields the library hasn't been updated
  // for. None of them affect format extraction or download -- they're noise
  // from the description / engagement-panel parser, which we don't consume.
  if (Log?.setLevel && Log?.Level) {
    Log.setLevel(Log.Level.ERROR);
  }

  // Provide a real JavaScript evaluator so the Player can decipher
  // signatureCipher / n-parameter for the formats it returns. The default
  // evaluator throws "To decipher URLs, you must provide your own JavaScript
  // evaluator." -- documented at https://ytjs.dev/guide/getting-started.html.
  // The script in `data.output` is fully self-contained and ends with a
  // `return process(...)` statement, so wrapping it in `new Function()` and
  // invoking it returns the `{ sig, n }` object the Player expects.
  if (Platform?.shim) {
    Platform.shim.eval = async (data) => new Function(data.output)();
  }

  // 1. Barebones Innertube to grab a visitorData.
  let yt = await Innertube.create({ retrieve_player: false });
  const visitorData = yt.session.context.client.visitorData;
  if (!visitorData) throw new Error('youtubei.js: no visitorData from initial session');

  // 2. Run the BotGuard challenge to mint a PO Token bound to visitorData.
  const requestKey = 'O43z0dpjhgX20SCx4KAo';
  const bgConfig = {
    fetch: (input, init) => fetch(input, init),
    globalObj: globalThis,
    identifier: visitorData,
    requestKey,
  };
  const bgChallenge = await BG.Challenge.create(bgConfig);
  if (!bgChallenge) throw new Error('youtubei.js: BG challenge creation returned null');

  const interpreterJavascript =
    bgChallenge.interpreterJavascript?.privateDoNotAccessOrElseSafeScriptWrappedValue;
  if (!interpreterJavascript) throw new Error('youtubei.js: BotGuard VM script missing');
  // Run the obfuscated VM in the global scope. Required by BG.PoToken.generate.
  new Function(interpreterJavascript)();

  const poTokenResult = await BG.PoToken.generate({
    program: bgChallenge.program,
    globalName: bgChallenge.globalName,
    bgConfig,
  });
  if (!poTokenResult?.poToken) throw new Error('youtubei.js: PO Token generation returned empty');

  // 3. Real Innertube instance with PO Token + cookies.
  const cookieString = buildYouTubeCookieString(cookieEntries);
  const opts = {
    po_token: poTokenResult.poToken,
    visitor_data: visitorData,
    cache: new UniversalCache(false),
    generate_session_locally: true,
  };
  if (cookieString) opts.cookie = cookieString;

  yt = await Innertube.create(opts);
  logger.info(
    `[YouTube] youtubei.js session ready (PO Token len=${poTokenResult.poToken.length}, cookies=${cookieString ? 'yes' : 'no'})`
  );
  return yt;
}

async function getInstance(cookieEntries) {
  const cookieKey = cookieEntries?.length
    ? `${cookieEntries.length}:${cookieEntries[0]?.name}`
    : '';
  if (cachedYt && cachedCookieKey === cookieKey) return cachedYt;
  if (initInFlight) return initInFlight;
  initInFlight = (async () => {
    try {
      const yt = await buildInstance(cookieEntries);
      cachedYt = yt;
      cachedCookieKey = cookieKey;
      return yt;
    } finally {
      initInFlight = null;
    }
  })();
  return initInFlight;
}

function extractVideoId(input) {
  const m = String(input || '').match(/(?:v=|\/shorts\/|youtu\.be\/|\/embed\/)([\w-]{11})/);
  if (m) return m[1];
  if (/^[\w-]{11}$/.test(input)) return input;
  return null;
}

// Clients to try, in order. Picked because:
//  - TV / IOS / WEB_EMBEDDED return formats with a plain `url` field (no
//    server-side signature cipher), so info.download() doesn't need to
//    decipher anything — sidesteps the regex-based player.js parser
//    failures we hit on WEB.
//  - MWEB and ANDROID_VR are last-ditch options that have historically
//    bypassed format-restriction edge cases.
//  - WEB is the original default. Kept last for accounts where the only
//    ciphered formats are returned.
const CLIENT_FALLBACK_CHAIN = ['TV', 'IOS', 'WEB_EMBEDDED', 'MWEB', 'ANDROID_VR', 'WEB'];

function infoHasPlayableFormats(info) {
  const sd = info?.streaming_data;
  if (!sd) return false;
  const fmts = (sd.formats || []).concat(sd.adaptive_formats || []);
  // Anything with a non-empty url, OR a deciphered URL we can resolve later.
  return fmts.some((f) => Boolean(f?.url) || Boolean(f?.signature_cipher) || Boolean(f?.cipher));
}

async function fetchInfoWithFallback(yt, id) {
  let lastErr = null;
  for (const client of CLIENT_FALLBACK_CHAIN) {
    try {
      const info = await yt.getInfo(id, { client });
      const status = info?.playability_status?.status;
      if (status && status !== 'OK') {
        logger.warn(
          `[YouTube] youtubei.js client=${client} returned status=${status} (${info?.playability_status?.reason || 'no reason'})`
        );
        lastErr = new Error(
          `youtubei.js client=${client} status=${status}: ${info?.playability_status?.reason || ''}`
        );
        continue;
      }
      if (!infoHasPlayableFormats(info)) {
        logger.warn(`[YouTube] youtubei.js client=${client} returned no playable formats`);
        lastErr = new Error(`youtubei.js client=${client} returned no playable formats`);
        continue;
      }
      logger.info(`[YouTube] youtubei.js using client=${client}`);
      return { info, client };
    } catch (err) {
      lastErr = err;
      logger.warn(`[YouTube] youtubei.js client=${client} threw: ${err.message}`);
    }
  }
  throw lastErr || new Error('youtubei.js: all clients exhausted');
}

// Some clients (notably TV / IOS) return a streamable response but a sparse
// basic_info — title/author empty even when playability_status is OK. The WEB
// client always populates basic_info even when its streaming_data is gated.
// Make a cheap metadata-only call on WEB when the streaming client's title is
// missing so we can build sensible filenames and API responses.
async function fillMissingMetadata(yt, id, basicInfo) {
  if (basicInfo?.title) return basicInfo;
  try {
    const probe = await yt.getBasicInfo(id, { client: 'WEB' });
    return probe?.basic_info || basicInfo;
  } catch {
    return basicInfo;
  }
}

async function getVideoMetadata(videoUrl, cookieEntries) {
  const yt = await getInstance(cookieEntries);
  const id = extractVideoId(videoUrl);
  if (!id) throw new Error(`youtubei.js: could not extract video id from "${videoUrl}"`);
  const { info, client } = await fetchInfoWithFallback(yt, id);
  const v = await fillMissingMetadata(yt, id, info.basic_info || {});
  return {
    info,
    yt,
    client,
    videoId: id,
    title: v.title || '',
    duration: v.duration || 0,
    uploader: v.author || '',
    thumbnail: v.thumbnail?.[v.thumbnail.length - 1]?.url || null,
  };
}

function pipeReadableToFile(stream, outPath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(outPath);
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
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
    stream.on('error', finish);
    ws.on('error', finish);
    ws.on('finish', () => finish());
    stream.pipe(ws);
  });
}

// YouTube heavily throttles single long-running adaptive streams (~50KB/s for
// non-bypass requests). Splitting a download into ~10MB ranged HTTP requests
// resets the throttle counter on each chunk and lets us hit normal speeds
// (hundreds of KB/s to several MB/s). This is what ytdl-core / yt-dlp do
// internally; youtubei.js itself does not, so we layer it on top.
const RANGE_CHUNK_SIZE = 10 * 1024 * 1024;

function pipeChunkAppend(stream, ws) {
  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(ws, { end: false });
  });
}

async function downloadFormatChunked(meta, format, outPath) {
  const totalSize = format.content_length || 0;

  // Fall back to the single-shot stream when we don't know the size (older
  // formats, live, post-live, etc.). Slow path, but safe.
  if (!totalSize) {
    const stream = toNodeReadable(await meta.info.download({ itag: format.itag }));
    await pipeReadableToFile(stream, outPath);
    return;
  }

  const ws = fs.createWriteStream(outPath);
  try {
    for (let start = 0; start < totalSize; start += RANGE_CHUNK_SIZE) {
      const end = Math.min(start + RANGE_CHUNK_SIZE - 1, totalSize - 1);
      const chunk = toNodeReadable(
        await meta.info.download({ itag: format.itag, range: { start, end } })
      );
      await pipeChunkAppend(chunk, ws);
    }
    await new Promise((resolve, reject) => {
      ws.on('finish', resolve);
      ws.on('error', reject);
      ws.end();
    });
  } catch (err) {
    ws.destroy();
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

// youtubei.js's info.download() returns a web ReadableStream in some envs and
// a Node Readable in others. Normalize to Node Readable.
function toNodeReadable(stream) {
  if (!stream) return stream;
  if (typeof stream.pipe === 'function') return stream;
  if (typeof Readable.fromWeb === 'function') return Readable.fromWeb(stream);
  // Last-resort manual conversion
  const reader = stream.getReader();
  return new Readable({
    async read() {
      try {
        const { done, value } = await reader.read();
        if (done) this.push(null);
        else this.push(Buffer.from(value));
      } catch (err) {
        this.destroy(err);
      }
    },
  });
}

async function downloadMp3(videoUrl, outPath, cookieEntries, providedMeta) {
  const meta = providedMeta || (await getVideoMetadata(videoUrl, cookieEntries));
  const sd = meta.info.streaming_data || {};
  const allFormats = [...(sd.formats || []), ...(sd.adaptive_formats || [])];
  const audioFmt = pickBestFormat(allFormats, (f) => f.has_audio && !f.has_video, null);
  if (!audioFmt) {
    throw new Error('youtubei.js: no audio format available');
  }

  // Download audio to a tmp file via chunked range requests, then transcode
  // to MP3 with ffmpeg from disk. This sidesteps YouTube's adaptive stream
  // throttling and is dramatically faster than streaming the format directly
  // through ffmpeg over a single HTTP connection.
  const tmpAudio = `${outPath}.audio.tmp`;
  try {
    await downloadFormatChunked(meta, audioFmt, tmpAudio);
    await new Promise((resolve, reject) => {
      ffmpeg(tmpAudio)
        .audioBitrate(192)
        .audioCodec('libmp3lame')
        .format('mp3')
        .on('error', reject)
        .on('end', () => resolve())
        .save(outPath);
    });
  } catch (err) {
    try {
      fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    try {
      fs.unlinkSync(tmpAudio);
    } catch {
      /* ignore */
    }
  }

  return meta;
}

// Pick the highest-quality format from a list, optionally capped at maxHeight.
// Returns null when no candidate satisfies the predicate.
function pickBestFormat(formats, predicate, maxHeight) {
  const filtered = formats
    .filter(predicate)
    .filter((f) => !maxHeight || (f.height && f.height <= maxHeight))
    .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.bitrate || 0) - (a.bitrate || 0));
  return filtered[0] || null;
}

async function downloadMp4(videoUrl, outPath, cookieEntries, providedMeta, opts = {}) {
  const meta = providedMeta || (await getVideoMetadata(videoUrl, cookieEntries));
  const maxHeight = opts.maxHeight || null;
  const sd = meta.info.streaming_data || {};
  const allFormats = [...(sd.formats || []), ...(sd.adaptive_formats || [])];

  // YouTube only publishes muxed (video+audio in one file) up to 360p. Anything
  // above 360p is adaptive only. So if there's an adaptive video stream that's
  // strictly higher resolution than the best muxed (still within the cap),
  // prefer adaptive -- otherwise the user asks for 1080p and gets 360p back.
  // The muxed fast-path is only worth taking when it actually delivers the
  // best resolution available under the cap.
  const muxed = pickBestFormat(allFormats, (f) => f.has_video && f.has_audio, maxHeight);
  const adaptiveVideoCandidate = pickBestFormat(
    allFormats,
    (f) => f.has_video && !f.has_audio,
    maxHeight
  );
  const muxedHeight = muxed?.height || 0;
  const adaptiveHeight = adaptiveVideoCandidate?.height || 0;
  const useMuxed = muxed && (!adaptiveVideoCandidate || adaptiveHeight <= muxedHeight);

  if (useMuxed) {
    try {
      logger.info(
        `[YouTube] youtubei.js MP4 muxed itag=${muxed.itag} height=${muxed.height || '?'}p (chunked)`
      );
      await downloadFormatChunked(meta, muxed, outPath);
      return meta;
    } catch (err) {
      logger.warn(
        `[YouTube] youtubei.js muxed itag=${muxed.itag} failed (${err.message}); falling back to adaptive merge.`
      );
    }
  } else if (muxed) {
    logger.info(
      `[YouTube] youtubei.js skipping muxed itag=${muxed.itag} (${muxedHeight}p) -- adaptive video at ${adaptiveHeight}p available`
    );
  } else if (maxHeight) {
    logger.info(`[YouTube] youtubei.js no muxed format <= ${maxHeight}p, using adaptive merge`);
  }

  // 2. Adaptive: separate video + audio streams, then ffmpeg mux.
  const videoFmt = adaptiveVideoCandidate;
  const audioFmt = pickBestFormat(allFormats, (f) => f.has_audio && !f.has_video, null);
  if (!videoFmt) {
    throw new Error(`youtubei.js: no playable video format${maxHeight ? ` <= ${maxHeight}p` : ''}`);
  }
  if (!audioFmt) {
    throw new Error('youtubei.js: no playable audio format for adaptive merge');
  }
  logger.info(
    `[YouTube] youtubei.js MP4 adaptive video itag=${videoFmt.itag} (${videoFmt.height || '?'}p) + audio itag=${audioFmt.itag}`
  );

  const tmpVideo = `${outPath}.video.tmp`;
  const tmpAudio = `${outPath}.audio.tmp`;
  try {
    // Run video and audio downloads in parallel; each one is internally
    // chunked into 10MB range requests to bypass YouTube's adaptive throttle.
    await Promise.all([
      downloadFormatChunked(meta, videoFmt, tmpVideo),
      downloadFormatChunked(meta, audioFmt, tmpAudio),
    ]);
    await new Promise((resolve, reject) => {
      ffmpeg()
        .addInput(tmpVideo)
        .addInput(tmpAudio)
        .outputOptions(['-c:v copy', '-c:a aac', '-movflags +faststart'])
        .format('mp4')
        .on('error', reject)
        .on('end', () => resolve())
        .save(outPath);
    });
  } finally {
    for (const f of [tmpVideo, tmpAudio]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }

  return meta;
}

// Force a re-init on next call. Called when a request fails in a way that
// suggests the cached PO token expired.
function invalidateSession() {
  cachedYt = null;
  cachedCookieKey = null;
}

module.exports = {
  getInstance,
  getVideoMetadata,
  downloadMp3,
  downloadMp4,
  invalidateSession,
};
