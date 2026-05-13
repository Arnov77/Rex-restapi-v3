const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { promisify } = require('util');
const { PassThrough } = require('stream');
const fluent = require('fluent-ffmpeg');
const JSZip = require('jszip');
const logger = require('../../../shared/utils/logger');
const { AppError, NotFoundError, ValidationError } = require('../../../shared/utils/errors');
const browserManager = require('../../../shared/browser/browserManager');
const { createGIF } = require('../../../shared/media/gif');

const gunzip = promisify(zlib.gunzip);

// Simple LRU: trim the oldest entry once we exceed MAX_CACHE_SIZE. Map keeps
// insertion order so `.keys().next().value` is the oldest entry.
const stickerCache = new Map();
const MAX_CACHE_SIZE = 200;

const FORMAT_META = {
  png: { mime: 'image/png', ext: 'png' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  gif: { mime: 'image/gif', ext: 'gif' },
  webp: { mime: 'image/webp', ext: 'webp' },
  wa: { mime: 'image/webp', ext: 'webp' },
};

// ─── Telegram API ───────────────────────────────────────────────────────────

async function getTelegramFileUrl(fileId, botToken) {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new ValidationError(
      'Bot token diperlukan. Set env TELEGRAM_BOT_TOKEN atau kirim param botToken.'
    );
  }

  let res;
  try {
    res = await axios.get(`https://api.telegram.org/bot${token}/getFile`, {
      params: { file_id: fileId },
      timeout: 12_000,
    });
  } catch (err) {
    if (err.response?.status === 401) throw new ValidationError('Bot token tidak valid.');
    if (err.response?.status === 400) throw new ValidationError('file_id tidak valid.');
    throw new AppError(`Telegram API error: ${err.message}`, 502);
  }

  if (!res.data?.ok) {
    throw new NotFoundError('File tidak ditemukan. Pastikan file_id benar dan bot punya akses.');
  }

  const filePath = res.data.result.file_path;
  return {
    url: `https://api.telegram.org/file/bot${token}/${filePath}`,
    filePath,
    fileSize: res.data.result.file_size || 0,
  };
}

async function downloadFile(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 20 * 1024 * 1024,
    });
    return {
      buffer: Buffer.from(res.data),
      contentType: res.headers['content-type'] || '',
    };
  } catch (err) {
    throw new AppError(`Gagal mengunduh file: ${err.message}`, 502);
  }
}

// ─── Type detection ─────────────────────────────────────────────────────────

function detectStickerType(buffer, filePath, contentType) {
  if (buffer && buffer.length >= 4) {
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) return 'tgs';
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3)
      return 'webm';
  }
  const ext = path.extname((filePath || '').split('?')[0]).toLowerCase();
  if (ext === '.tgs') return 'tgs';
  if (ext === '.webm' || (contentType || '').includes('video')) return 'webm';
  return 'webp';
}

// ─── Convert: static WebP ───────────────────────────────────────────────────

async function convertWebp(buffer, format) {
  let result;
  switch (format) {
    case 'jpg':
    case 'jpeg':
      result = await sharp(buffer)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90 })
        .toBuffer();
      break;
    case 'gif':
      result = await sharp(buffer).gif().toBuffer();
      break;
    case 'webp':
      result = await sharp(buffer).webp({ quality: 90, effort: 4 }).toBuffer();
      break;
    case 'wa':
      result = await sharp(buffer)
        .resize(512, 512, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .webp({ quality: 80, effort: 6 })
        .toBuffer();
      break;
    case 'png':
    default:
      result = await sharp(buffer).png().toBuffer();
  }
  const meta = FORMAT_META[format] || FORMAT_META.png;
  return { buffer: result, ...meta };
}

// ─── Convert: TGS (animated Lottie) ─────────────────────────────────────────

// lottie.min.js is ~1MB and never changes within a process. Cache the read on
// first use so /api/telegram/sticker doesn't pay disk cost per request.
let cachedLottieScript = null;
function loadLottieScript() {
  if (cachedLottieScript) return cachedLottieScript;
  const lottiePath = path.join(
    __dirname,
    '../../../../node_modules/lottie-web/build/player/lottie.min.js'
  );
  if (!fs.existsSync(lottiePath)) {
    throw new AppError('lottie-web tidak ditemukan. Jalankan: npm install lottie-web', 500);
  }
  cachedLottieScript = fs.readFileSync(lottiePath, 'utf-8');
  return cachedLottieScript;
}

function buildLottieHtml(lottieJson) {
  const lottieScript = loadLottieScript();
  const jsonStr = JSON.stringify(lottieJson);
  return `<!DOCTYPE html>
<html><head><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:512px;height:512px;background:transparent;overflow:hidden}
  #lottie-canvas{width:512px;height:512px}
</style></head><body>
<div id="lottie-canvas"></div>
<script>${lottieScript}</script>
<script>
window.animReady=false;
try{
  window.anim=lottie.loadAnimation({
    container:document.getElementById('lottie-canvas'),
    renderer:'canvas',
    loop:false,
    autoplay:false,
    animationData:${jsonStr},
    rendererSettings:{clearCanvas:true,progressiveLoad:false,preserveAspectRatio:'xMidYMid meet'}
  });
  window.anim.addEventListener('DOMLoaded',()=>{window.animReady=true;});
}catch(e){window.animReady=true;}
</script></body></html>`;
}

// Shared browser via browserManager; per-call isolation via newContext().
async function renderLottieFrame(lottieJson, frameNumber) {
  return browserManager.withPage(
    async (page) => {
      await page.setContent(buildLottieHtml(lottieJson), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.animReady, { timeout: 12_000 });
      await page.evaluate((f) => window.anim.goToAndStop(f, true), frameNumber);
      await page.waitForTimeout(200);
      const el = await page.$('#lottie-canvas');
      return el.screenshot({ omitBackground: true, type: 'png' });
    },
    { viewport: { width: 512, height: 512 } }
  );
}

async function renderLottieAllFrames(lottieJson, maxFrames = 60) {
  return browserManager.withPage(
    async (page) => {
      await page.setContent(buildLottieHtml(lottieJson), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.animReady, { timeout: 12_000 });

      const totalFrames = await page.evaluate(() => Math.floor(window.anim.totalFrames));
      const step = Math.max(1, Math.floor(totalFrames / maxFrames));
      const el = await page.$('#lottie-canvas');
      const frames = [];

      for (let f = 0; f < totalFrames; f += step) {
        await page.evaluate((frame) => window.anim.goToAndStop(frame, true), f);
        await page.waitForTimeout(20);
        frames.push(await el.screenshot({ omitBackground: true, type: 'png' }));
      }
      return frames;
    },
    { viewport: { width: 512, height: 512 } }
  );
}

async function convertTgs(tgsBuffer, format) {
  let lottieJson;
  try {
    const raw = await gunzip(tgsBuffer);
    lottieJson = JSON.parse(raw.toString('utf-8'));
  } catch {
    throw new AppError('File TGS tidak valid: gagal dekompresi atau parse JSON.', 400);
  }

  if (format === 'png' || format === 'jpg' || format === 'jpeg') {
    const frameBuf = await renderLottieFrame(lottieJson, 0);
    if (format === 'jpg' || format === 'jpeg') {
      const jpgBuf = await sharp(frameBuf)
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 90 })
        .toBuffer();
      return { buffer: jpgBuf, ...FORMAT_META.jpg };
    }
    return { buffer: frameBuf, ...FORMAT_META.png };
  }

  if (format === 'webp') {
    const frameBuf = await renderLottieFrame(lottieJson, 0);
    const webpBuf = await sharp(frameBuf).webp({ quality: 85 }).toBuffer();
    return { buffer: webpBuf, ...FORMAT_META.webp };
  }

  const frames = await renderLottieAllFrames(lottieJson);
  const gifBuf = await createGIF(frames);
  return { buffer: gifBuf, ...FORMAT_META.gif };
}

// ─── Convert: WebM (video sticker) — stream in/out, no disk I/O ─────────────

function extractWebmFrameStream(buffer, format) {
  return new Promise((resolve, reject) => {
    const isjpg = format === 'jpg' || format === 'jpeg';
    const vcodec = isjpg ? 'mjpeg' : 'png';

    const inputStream = new PassThrough();
    inputStream.end(buffer);

    const bufs = [];
    const outputStream = new PassThrough();
    outputStream.on('data', (chunk) => bufs.push(chunk));
    outputStream.on('end', () => {
      const finalBuf = Buffer.concat(bufs);
      resolve({ buffer: finalBuf, ...(isjpg ? FORMAT_META.jpg : FORMAT_META.png) });
    });
    outputStream.on('error', reject);

    fluent(inputStream)
      .inputFormat('webm')
      .outputOptions(['-vframes 1', '-f image2', `-c:v ${vcodec}`])
      .on('error', (err) => reject(new AppError(`ffmpeg frame extract: ${err.message}`, 500)))
      .pipe(outputStream, { end: true });
  });
}

function webmToGifStream(buffer) {
  return new Promise((resolve, reject) => {
    const inputStream = new PassThrough();
    inputStream.end(buffer);

    const bufs = [];
    const outputStream = new PassThrough();
    outputStream.on('data', (chunk) => bufs.push(chunk));
    outputStream.on('end', () => resolve(Buffer.concat(bufs)));
    outputStream.on('error', reject);

    fluent(inputStream)
      .inputFormat('webm')
      .outputFormat('gif')
      .outputOptions([
        '-vf fps=30,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0',
        '-loop 0',
        '-r 30',
      ])
      .on('error', (err) => reject(new AppError(`ffmpeg webm→gif: ${err.message}`, 500)))
      .pipe(outputStream, { end: true });
  });
}

async function convertWebm(buffer, format) {
  switch (format) {
    case 'png':
    case 'jpg':
    case 'jpeg':
      return extractWebmFrameStream(buffer, format);
    case 'webp':
    case 'wa':
    case 'gif':
    default: {
      const gifBuf = await webmToGifStream(buffer);
      return { buffer: gifBuf, ...FORMAT_META.gif };
    }
  }
}

// ─── Sticker pack ───────────────────────────────────────────────────────────

async function getStickerSet(packNameOrUrl, botToken) {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new ValidationError('Bot token diperlukan. Set env TELEGRAM_BOT_TOKEN.');
  }

  const packName = packNameOrUrl.replace('https://t.me/addstickers/', '').split('/')[0].trim();

  let res;
  try {
    res = await axios.get(`https://api.telegram.org/bot${token}/getStickerSet`, {
      params: { name: packName },
      timeout: 10_000,
    });
  } catch (err) {
    if (err.response?.status === 400) {
      throw new NotFoundError('Nama Sticker Pack tidak valid atau tidak ditemukan.');
    }
    throw new AppError(`Gagal mengambil data pack: ${err.message}`, 502);
  }

  if (!res.data?.ok) throw new NotFoundError('Sticker pack tidak ditemukan.');

  const pack = res.data.result;
  return {
    title: pack.title,
    name: pack.name,
    isAnimated: pack.is_animated,
    isVideo: pack.is_video,
    totalStickers: pack.stickers.length,
    stickers: pack.stickers.map((s) => ({ fileId: s.file_id, emoji: s.emoji })),
  };
}

// ─── Main entry ─────────────────────────────────────────────────────────────

async function processSticker({ fileId, url, botToken, format = 'png' }) {
  const fmt = format.toLowerCase();
  if (!FORMAT_META[fmt]) {
    throw new ValidationError(`Format tidak didukung: ${format}. Pilih: png, jpg, gif, webp, wa`);
  }

  const cacheKey = `${fileId || url}-${fmt}`;
  if (stickerCache.has(cacheKey)) {
    logger.info(`[Telegram] Mengambil dari CACHE: ${cacheKey}`);
    return stickerCache.get(cacheKey);
  }

  let fileUrl;
  let filePath;
  if (url) {
    fileUrl = url;
    filePath = url.split('?')[0];
  } else if (fileId) {
    const info = await getTelegramFileUrl(fileId, botToken);
    fileUrl = info.url;
    filePath = info.filePath;
  } else {
    throw new ValidationError('Sediakan fileId atau url.');
  }

  const { buffer, contentType } = await downloadFile(fileUrl);
  const stickerType = detectStickerType(buffer, filePath, contentType);

  logger.info(`[Telegram] Proses Baru Type: ${stickerType} → format: ${fmt}`);

  let result;
  switch (stickerType) {
    case 'tgs':
      result = await convertTgs(buffer, fmt);
      break;
    case 'webm':
      result = await convertWebm(buffer, fmt);
      break;
    default:
      result = await convertWebp(buffer, fmt);
      break;
  }

  const finalResult = { ...result, stickerType };

  if (stickerCache.size >= MAX_CACHE_SIZE) {
    const firstKey = stickerCache.keys().next().value;
    stickerCache.delete(firstKey);
  }
  stickerCache.set(cacheKey, finalResult);

  return finalResult;
}

// ─── WASticker pack builder ─────────────────────────────────────────────────
// Produces a `.wasticker` archive (zip) — or, when the source pack exceeds the
// WhatsApp per-pack limit (30), a `.zip` of multiple `.wasticker` parts.
//
// Layout: most third-party WA sticker importer apps (e.g. Sticker Maker,
// Personal Stickers) read a flat-text format — `title.txt`, `author.txt`,
// `tray.png` and the WebP files — instead of a `contents.json` manifest. We
// emit that flat layout directly at the zip root (no subfolders) so the
// archive imports cleanly without further repackaging.

const MAX_STICKERS_PER_PACK = 30;
const DEFAULT_AUTHOR = 'Converted via Rex REST API';

function sanitizeIdentifier(input) {
  return (
    (input || 'rex_pack')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64) || 'rex_pack'
  );
}

// WA tray icon must be 96×96 PNG. We generate it by fitting the first sticker
// (any type) into a 96×96 frame with an opaque white background. TGS/WEBM
// animations aren't supported as a tray; we grab frame 0 in those cases.
async function buildTrayIcon(firstStickerBuffer) {
  try {
    return await sharp(firstStickerBuffer)
      .resize(96, 96, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();
  } catch (err) {
    logger.warn(`[Telegram] Tray icon fallback (blank): ${err.message}`);
    // Fallback to a blank 96×96 PNG so the pack is still valid.
    return sharp({
      create: { width: 96, height: 96, channels: 4, background: '#ffffff' },
    })
      .png()
      .toBuffer();
  }
}

// Process every sticker in the pack in parallel but bounded — running 50+
// ffmpeg/lottie conversions concurrently would starve the event loop and
// thrash the shared browser pool. 4 at a time gives good throughput without
// overwhelming Chromium.
async function processStickersConcurrent(stickers, botToken, concurrency = 4) {
  const results = new Array(stickers.length);
  let cursor = 0;

  async function worker() {
    while (cursor < stickers.length) {
      const i = cursor++;
      const { fileId, emoji } = stickers[i];
      try {
        const { buffer } = await processSticker({ fileId, botToken, format: 'wa' });
        results[i] = { index: i, buffer, emoji };
      } catch (err) {
        logger.warn(`[Telegram] Sticker #${i} failed (${fileId}): ${err.message}`);
        results[i] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, stickers.length) }, () => worker()));
  return results.filter(Boolean);
}

// Build a single .wasticker buffer for `slice` stickers using the flat
// title.txt + author.txt layout (no contents.json, no subfolders).
async function buildSingleWAStickerBuffer({ slice, title, author, trayBuffer }) {
  const zip = new JSZip();

  zip.file('title.txt', title);
  zip.file('author.txt', author);
  zip.file('tray.png', trayBuffer);
  slice.forEach((s, idx) => {
    zip.file(`${idx + 1}.webp`, s.buffer);
  });

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function buildWAStickerPack({
  packNameOrUrl,
  botToken,
  publisher = 'Rex API',
  author = DEFAULT_AUTHOR,
  stickersPerPack = MAX_STICKERS_PER_PACK,
}) {
  const pack = await getStickerSet(packNameOrUrl, botToken);

  if (!pack.stickers.length) {
    throw new NotFoundError('Sticker pack kosong atau tidak ada sticker yang bisa diambil.');
  }

  const limit = Math.min(Math.max(1, stickersPerPack), MAX_STICKERS_PER_PACK);
  logger.info(
    `[Telegram] Building .wasticker for "${pack.name}" — ${pack.stickers.length} stickers, ${limit}/part`
  );

  const processed = await processStickersConcurrent(pack.stickers, botToken);
  if (!processed.length) {
    throw new AppError('Tidak ada sticker yang berhasil dikonversi.', 502);
  }

  const trayBuffer = await buildTrayIcon(processed[0].buffer);
  const baseIdentifier = sanitizeIdentifier(pack.name);
  const baseTitle = pack.title || pack.name;

  // Single-part case: return the .wasticker buffer directly.
  if (processed.length <= limit) {
    const buffer = await buildSingleWAStickerBuffer({
      slice: processed,
      title: `${baseTitle} - ${publisher}`,
      author,
      trayBuffer,
    });
    return {
      buffer,
      filename: `${baseIdentifier}.wasticker`,
      contentType: 'application/octet-stream',
      parts: 1,
      totalStickers: processed.length,
    };
  }

  // Multi-part case: one .wasticker per chunk, all bundled in an outer .zip.
  // Each part's title carries the part suffix so importers display them as
  // distinct packs instead of overwriting each other.
  const outerZip = new JSZip();
  const totalParts = Math.ceil(processed.length / limit);

  for (let part = 0; part < totalParts; part++) {
    const slice = processed.slice(part * limit, (part + 1) * limit);
    const partId = `${baseIdentifier}_part${part + 1}`;
    const partBuffer = await buildSingleWAStickerBuffer({
      slice,
      title: `${baseTitle} Part ${part + 1} - ${publisher}`,
      author,
      trayBuffer,
    });
    outerZip.file(`${partId}.wasticker`, partBuffer);
  }

  const buffer = await outerZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    filename: `${baseIdentifier}_${totalParts}parts.zip`,
    contentType: 'application/zip',
    parts: totalParts,
    totalStickers: processed.length,
  };
}

module.exports = { processSticker, getStickerSet, buildWAStickerPack };
