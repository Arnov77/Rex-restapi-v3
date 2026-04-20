const axios = require('axios');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { promisify } = require('util');
const fluent = require('fluent-ffmpeg');
const logger = require('../../../shared/utils/logger');
const { AppError, NotFoundError, ValidationError } = require('../../../shared/utils/errors');
const { getBrowser } = require('../../../utils/browser');
const { createGIF } = require('../../../utils/gif');

const gunzip = promisify(zlib.gunzip);

const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

/**
 * Supported output formats and their metadata
 */
const FORMAT_META = {
  png:  { mime: 'image/png',  ext: 'png'  },
  jpg:  { mime: 'image/jpeg', ext: 'jpg'  },
  jpeg: { mime: 'image/jpeg', ext: 'jpg'  },
  gif:  { mime: 'image/gif',  ext: 'gif'  },
  webp: { mime: 'image/webp', ext: 'webp' },
  wa:   { mime: 'image/webp', ext: 'webp' }, // WhatsApp sticker optimised
};

/**
 * Telegram Sticker Service
 *
 * Supports three Telegram sticker types:
 *   • Static  (.webp) — converted with sharp
 *   • Animated (.tgs) — gzip-compressed Lottie JSON, rendered via Playwright
 *   • Video  (.webm)  — video sticker, converted with ffmpeg
 *
 * Format "wa" → 512×512 WebP (static) or animated GIF sized 512×512 (animated).
 * Most WhatsApp bot libraries (baileys, whatsapp-web.js) accept GIF for animated stickers.
 */
class TelegramStickerService {
  // ─── Telegram API ────────────────────────────────────────────────────────────

  /**
   * Call Telegram getFile API and return the CDN download URL + file path.
   */
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

  detectStickerType(filePath, contentType) {
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
        // Sharp ≥0.31 supports GIF output for static images
        result = await sharp(buffer).gif().toBuffer();
        break;

      case 'webp':
        result = await sharp(buffer).webp({ quality: 90, effort: 4 }).toBuffer();
        break;

      case 'wa':
        // WhatsApp sticker: 512×512 WebP, transparent bg preserved
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
    logger.info('[Telegram] Decompressing TGS...');

    let lottieJson;
    try {
      const raw = await gunzip(tgsBuffer);
      lottieJson = JSON.parse(raw.toString('utf-8'));
    } catch (err) {
      throw new AppError('File TGS tidak valid: gagal dekompresi atau parse JSON.', 400);
    }

    // Single-frame outputs
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
      // Static WebP of frame 0
      const frameBuf = await this._renderLottieFrame(lottieJson, 0);
      const webpBuf = await sharp(frameBuf).webp({ quality: 85 }).toBuffer();
      return { buffer: webpBuf, ...FORMAT_META.webp };
    }

    // GIF / wa → render all frames and build animated GIF
    logger.info('[Telegram] Rendering all Lottie frames...');
    const frames = await this._renderLottieAllFrames(lottieJson);
    const gifBuf = await createGIF(frames);
    return { buffer: gifBuf, ...FORMAT_META.gif };
  }

  async _renderLottieFrame(lottieJson, frameNumber) {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 512, height: 512 });
      await page.setContent(this._buildLottieHtml(lottieJson), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.animReady, { timeout: 12_000 });
      await page.evaluate((f) => window.anim.goToAndStop(f, true), frameNumber);
      await page.waitForTimeout(200);

      const el = await page.$('#lottie-canvas');
      return await el.screenshot({ omitBackground: true, type: 'png' });
    } finally {
      await browser.close();
    }
  }

  async _renderLottieAllFrames(lottieJson, maxFrames = 32) {
    const browser = await getBrowser();
    try {
      const page = await browser.newPage();
      await page.setViewportSize({ width: 512, height: 512 });
      await page.setContent(this._buildLottieHtml(lottieJson), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.animReady, { timeout: 12_000 });

      const totalFrames = await page.evaluate(() => Math.floor(window.anim.totalFrames));
      const step = Math.max(1, Math.floor(totalFrames / maxFrames));
      const el = await page.$('#lottie-canvas');
      const frames = [];

      logger.info(`[Telegram] Total Lottie frames: ${totalFrames}, step: ${step}`);

      for (let f = 0; f < totalFrames; f += step) {
        await page.evaluate((frame) => window.anim.goToAndStop(frame, true), f);
        await page.waitForTimeout(40);
        frames.push(await el.screenshot({ omitBackground: true, type: 'png' }));
      }

      logger.success(`[Telegram] Captured ${frames.length} frames from Lottie`);
      return frames;
    } finally {
      await browser.close();
    }
  }

  _buildLottieHtml(lottieJson) {
    // Load lottie.min.js from node_modules — no CDN required
    const possiblePaths = [
      path.join(__dirname, '../../../../node_modules/lottie-web/build/player/lottie.min.js'),
    ];
    let lottieScript = null;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) { lottieScript = fs.readFileSync(p, 'utf-8'); break; }
    }
    if (!lottieScript) {
      throw new AppError(
        'lottie-web tidak ditemukan. Jalankan: npm install lottie-web', 500
      );
    }

    const jsonStr = JSON.stringify(lottieJson);
    return `<!DOCTYPE html>
<html>
<head>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:512px;height:512px;background:transparent;overflow:hidden}
  #lottie-canvas{width:512px;height:512px}
</style>
</head>
<body>
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
</script>
</body>
</html>`;
  }

  // ─── Convert: WebM (video sticker) ────────────────────────────────────────────

  async convertWebm(buffer, format) {
    const tmpId = Date.now();
    const tmpIn = path.join(DOWNLOAD_DIR, `tmp-${tmpId}.webm`);
    fs.writeFileSync(tmpIn, buffer);

    try {
      switch (format) {
        case 'png':
        case 'jpg':
        case 'jpeg':
          return await this._extractWebmFrame(tmpIn, format);

        case 'webp':
        case 'wa':
        case 'gif':
        default:
          const gifBuf = await this._webmToGif(tmpIn);
          return { buffer: gifBuf, ...FORMAT_META.gif };
      }
    } finally {
      try { fs.unlinkSync(tmpIn); } catch {}
    }
  }

  async _extractWebmFrame(inputPath, format) {
    return new Promise((resolve, reject) => {
      const isjpg = format === 'jpg' || format === 'jpeg';
      const outputPath = inputPath.replace('.webm', isjpg ? '.jpg' : '.png');

      fluent(inputPath)
        .outputOptions(['-vframes', '1'])
        .output(outputPath)
        .on('end', () => {
          try {
            const buf = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            resolve({ buffer: buf, ...(isjpg ? FORMAT_META.jpg : FORMAT_META.png) });
          } catch (err) { reject(err); }
        })
        .on('error', (err) => reject(new AppError(`ffmpeg frame extract: ${err.message}`, 500)))
        .run();
    });
  }

  async _webmToGif(inputPath) {
    return new Promise((resolve, reject) => {
      const outputPath = inputPath.replace('.webm', '.gif');

      fluent(inputPath)
        .output(outputPath)
        .outputOptions([
          '-vf', [
            'scale=512:512:force_original_aspect_ratio=decrease',
            'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=black@0',
          ].join(','),
          '-loop', '0',
          '-r', '15',
        ])
        .on('end', () => {
          try {
            const buf = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            resolve(buf);
          } catch (err) { reject(err); }
        })
        .on('error', (err) => reject(new AppError(`ffmpeg webm→gif: ${err.message}`, 500)))
        .run();
    });
  }

  // ─── Main entry point ─────────────────────────────────────────────────────────

  /**
   * Process a Telegram sticker end-to-end.
   * @param {Object} params
   * @param {string} [params.fileId]   - Telegram file_id
   * @param {string} [params.url]      - Direct URL to sticker file
   * @param {string} [params.botToken] - Override bot token
   * @param {string} [params.format]   - Output format: png|jpg|gif|webp|wa (default: png)
   * @returns {{ buffer: Buffer, mime: string, ext: string, stickerType: string }}
   */
  async processSticker({ fileId, url, botToken, format = 'png' }) {
    const fmt = format.toLowerCase();
    if (!FORMAT_META[fmt]) {
      throw new ValidationError(`Format tidak didukung: ${format}. Pilih: png, jpg, gif, webp, wa`);
    }

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
    const stickerType = this.detectStickerType(filePath, contentType);

    logger.info(`[Telegram] Type: ${stickerType} → format: ${fmt}`);

    let result;
    switch (stickerType) {
      case 'tgs':   result = await this.convertTgs(buffer, fmt);   break;
      case 'webm':  result = await this.convertWebm(buffer, fmt);  break;
      default:      result = await this.convertWebp(buffer, fmt);  break;
    }

    return { ...result, stickerType };
  }
}

module.exports = new TelegramStickerService();
