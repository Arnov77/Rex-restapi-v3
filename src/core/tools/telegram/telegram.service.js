const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { promisify } = require('util');
const { PassThrough } = require('stream'); // Ditambahkan untuk Stream WebM
const fluent = require('fluent-ffmpeg');
const logger = require('../../../shared/utils/logger');
const { AppError, NotFoundError, ValidationError } = require('../../../shared/utils/errors');
const browserManager = require('../../../shared/browser/browserManager');
const { createGIF } = require('../../../shared/media/gif');

const gunzip = promisify(zlib.gunzip);

// Cache global untuk stiker
const stickerCache = new Map();
const MAX_CACHE_SIZE = 200; // Maksimal simpan 200 hasil di RAM agar tidak berat

const FORMAT_META = {
  png: { mime: 'image/png', ext: 'png' },
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  gif: { mime: 'image/gif', ext: 'gif' },
  webp: { mime: 'image/webp', ext: 'webp' },
  wa: { mime: 'image/webp', ext: 'webp' },
};

class TelegramStickerService {
  // ─── Telegram API ────────────────────────────────────────────────────────────

  async getTelegramFileUrl(fileId, botToken) {
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

  // ─── Download ────────────────────────────────────────────────────────────────

  async downloadFile(url) {
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

  // ─── Type detection ───────────────────────────────────────────────────────────

  detectStickerType(buffer, filePath, contentType) {
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

  // ─── Convert: static WebP ────────────────────────────────────────────────────

  async convertWebp(buffer, format) {
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

  async convertTgs(tgsBuffer, format) {
    let lottieJson;
    try {
      const raw = await gunzip(tgsBuffer);
      lottieJson = JSON.parse(raw.toString('utf-8'));
    } catch (err) {
      throw new AppError('File TGS tidak valid: gagal dekompresi atau parse JSON.', 400);
    }

    if (format === 'png' || format === 'jpg' || format === 'jpeg') {
      const frameBuf = await this._renderLottieFrame(lottieJson, 0);
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
      const frameBuf = await this._renderLottieFrame(lottieJson, 0);
      const webpBuf = await sharp(frameBuf).webp({ quality: 85 }).toBuffer();
      return { buffer: webpBuf, ...FORMAT_META.webp };
    }

    const frames = await this._renderLottieAllFrames(lottieJson);
    const gifBuf = await createGIF(frames);
    return { buffer: gifBuf, ...FORMAT_META.gif };
  }

  // Use the app-wide shared browser via browserManager. Per-call isolation is
  // provided by `browser.newContext()` (incognito profile + no shared
  // cookies); the browser process itself stays alive across requests.
  async _renderLottieFrame(lottieJson, frameNumber) {
    return browserManager.withPage(
      async (page) => {
        await page.setContent(this._buildLottieHtml(lottieJson), {
          waitUntil: 'domcontentloaded',
        });
        await page.waitForFunction(() => window.animReady, { timeout: 12_000 });
        await page.evaluate((f) => window.anim.goToAndStop(f, true), frameNumber);
        await page.waitForTimeout(200);

        const el = await page.$('#lottie-canvas');
        return el.screenshot({ omitBackground: true, type: 'png' });
      },
      { viewport: { width: 512, height: 512 } }
    );
  }

  async _renderLottieAllFrames(lottieJson, maxFrames = 60) {
    return browserManager.withPage(
      async (page) => {
        await page.setContent(this._buildLottieHtml(lottieJson), {
          waitUntil: 'domcontentloaded',
        });
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

  _buildLottieHtml(lottieJson) {
    const possiblePaths = [
      path.join(__dirname, '../../../../node_modules/lottie-web/build/player/lottie.min.js'),
    ];
    let lottieScript = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        lottieScript = fs.readFileSync(p, 'utf-8');
        break;
      }
    }
    if (!lottieScript) {
      throw new AppError('lottie-web tidak ditemukan. Jalankan: npm install lottie-web', 500);
    }

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

  // ─── Convert: WebM (video sticker) ────────────────────────────────────────────
  // OPTIMASI: Pipa data langsung via stream tanpa Write File I/O
  async convertWebm(buffer, format) {
    switch (format) {
      case 'png':
      case 'jpg':
      case 'jpeg':
        return await this._extractWebmFrameStream(buffer, format);
      case 'webp':
      case 'wa':
      case 'gif':
      default:
        const gifBuf = await this._webmToGifStream(buffer);
        return { buffer: gifBuf, ...FORMAT_META.gif };
    }
  }

  async _extractWebmFrameStream(buffer, format) {
    return new Promise((resolve, reject) => {
      const isjpg = format === 'jpg' || format === 'jpeg';
      const outFormat = 'image2';
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
        .outputOptions(['-vframes 1', `-f ${outFormat}`, `-c:v ${vcodec}`])
        .on('error', (err) => reject(new AppError(`ffmpeg frame extract: ${err.message}`, 500)))
        .pipe(outputStream, { end: true });
    });
  }

  async _webmToGifStream(buffer) {
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
          // Perbaikan kualitas GIF dengan palettegen dan frame rate 30fps
          '-vf fps=30,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0',
          '-loop 0',
          '-r 30', // <-- INI KUNCI UTAMA KESMOOTHAN (30 Frame per second)
        ])
        .on('error', (err) => reject(new AppError(`ffmpeg webm→gif: ${err.message}`, 500)))
        .pipe(outputStream, { end: true });
    });
  }

  // ─── Get Sticker Pack ────────────────────────────────────────────────────────

  async getStickerSet(packNameOrUrl, botToken) {
    const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      throw new ValidationError('Bot token diperlukan. Set env TELEGRAM_BOT_TOKEN.');
    }

    // Kalau user masukin full URL (https://t.me/addstickers/NamaPack), kita ambil namanya aja
    let packName = packNameOrUrl.replace('https://t.me/addstickers/', '').split('/')[0].trim();

    try {
      const res = await axios.get(`https://api.telegram.org/bot${token}/getStickerSet`, {
        params: { name: packName },
        timeout: 10_000,
      });

      if (!res.data?.ok) throw new NotFoundError('Sticker pack tidak ditemukan.');

      const pack = res.data.result;

      // Susun ulang datanya biar rapi saat dikirim ke frontend
      return {
        title: pack.title,
        name: pack.name,
        isAnimated: pack.is_animated,
        isVideo: pack.is_video,
        totalStickers: pack.stickers.length,
        stickers: pack.stickers.map((s) => ({
          fileId: s.file_id,
          emoji: s.emoji,
        })),
      };
    } catch (err) {
      if (err.response?.status === 400) {
        throw new NotFoundError('Nama Sticker Pack tidak valid atau tidak ditemukan.');
      }
      throw new AppError(`Gagal mengambil data pack: ${err.message}`, 502);
    }
  }

  // ─── Main entry point ─────────────────────────────────────────────────────────

  async processSticker({ fileId, url, botToken, format = 'png' }) {
    const fmt = format.toLowerCase();
    if (!FORMAT_META[fmt]) {
      throw new ValidationError(`Format tidak didukung: ${format}. Pilih: png, jpg, gif, webp, wa`);
    }

    // 1. Cek dari Cache dulu
    const cacheKey = `${fileId || url}-${fmt}`;
    if (stickerCache.has(cacheKey)) {
      logger.info(`[Telegram] Mengambil dari CACHE: ${cacheKey}`);
      return stickerCache.get(cacheKey);
    }

    // 2. Kalau tidak ada di cache, download & proses
    let fileUrl, filePath;

    if (url) {
      fileUrl = url;
      filePath = url.split('?')[0];
    } else if (fileId) {
      const info = await this.getTelegramFileUrl(fileId, botToken);
      fileUrl = info.url;
      filePath = info.filePath;
    } else {
      throw new ValidationError('Sediakan fileId atau url.');
    }

    const { buffer, contentType } = await this.downloadFile(fileUrl);
    const stickerType = this.detectStickerType(buffer, filePath, contentType);

    logger.info(`[Telegram] Proses Baru Type: ${stickerType} → format: ${fmt}`);

    let result;
    switch (stickerType) {
      case 'tgs':
        result = await this.convertTgs(buffer, fmt);
        break;
      case 'webm':
        result = await this.convertWebm(buffer, fmt);
        break;
      default:
        result = await this.convertWebp(buffer, fmt);
        break;
    }

    const finalResult = { ...result, stickerType };

    // 3. Simpan ke Cache (Rotasi jika sudah lebih dari 200 item agar RAM aman)
    if (stickerCache.size >= MAX_CACHE_SIZE) {
      const firstKey = stickerCache.keys().next().value;
      stickerCache.delete(firstKey);
    }
    stickerCache.set(cacheKey, finalResult);

    return finalResult;
  }
}

module.exports = new TelegramStickerService();
