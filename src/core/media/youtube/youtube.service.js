const play = require('play-dl');
const youtubedl = require('youtube-dl-exec');
const logger = require('../../../shared/utils/logger');
const { NotFoundError, AppError } = require('../../../shared/utils/errors');
const fs = require('fs-extra');
const path = require('path');
const { randomUUID } = require('crypto');

const DOWNLOAD_DIR = path.join(__dirname, '../../../../downloads');
fs.ensureDirSync(DOWNLOAD_DIR);

function writeCookieToTmp() {
  const b64 = process.env.YOUTUBE_COOKIES_B64;
  if (!b64) return null;
  const tmpPath = `/tmp/ck_${randomUUID()}.txt`;
  fs.writeFileSync(tmpPath, Buffer.from(b64, 'base64').toString('utf-8'), { mode: 0o600 });
  return tmpPath;
}

function cleanupCookies(tmpPath) {
  if (tmpPath && fs.existsSync(tmpPath)) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

function hasCookies() {
  return Boolean(process.env.YOUTUBE_COOKIES_B64);
}

function sanitizeFilename(title, ext) {
  let clean = title
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim()
    .toLowerCase();
  if (!clean) clean = 'media';
  clean = clean.substring(0, 40);
  const uid = randomUUID().split('-')[0];
  return `${uid}-${clean}.${ext}`;
}

function getBaseOptions(cookiePath) {
  const opts = {
    addHeader: [
      'User-Agent: com.google.ios.youtube/19.14.3 (iPhone16,2; iOS 17_4_1; Scale/3.00)',
      'Accept-Language: en-US,en;q=0.9',
    ],
    // ✅ FIX: 'web' client works reliably on cloud; removed 'default' which caused
    // "Requested format is not available" on some videos
    extractorArgs: 'youtube:player_client=ios',
    geoBypass: true,
    retries: 5,
    fragmentRetries: 5,
    noWarnings: true,
  };
  if (cookiePath) {
    opts.cookies = cookiePath;
  } else {
    logger.warn('[YouTube] YOUTUBE_COOKIES_B64 not set — may be blocked on cloud servers');
  }
  return opts;
}

async function getBestProxy() {
  try {
    const response = await axios.get('https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.json');
    const samples = response.data.sort(() => 0.5 - Math.random()).slice(0, 5);
    
    for (const p of samples) {
      const proxyUrl = `socks5://${p.ip}:${p.port}`;
      try {
        // Test singkat ke youtube
        await axios.get('https://www.youtube.com', { 
          httpsAgent: new SocksProxyAgent(proxyUrl), 
          timeout: 5000 
        });
        return proxyUrl;
      } catch (e) { continue; }
    }
  } catch (e) { return null; }
}

class YouTubeService {
  async searchVideos(query, limit = 5) {
    try {
      logger.info(`[YouTube] Searching for: "${query}"`);
      const results = await play.search(query, { limit });
      if (!results || results.length === 0) throw new NotFoundError('No videos found on YouTube');
      const videos = results
        .filter(v => v.type === 'video')
        .slice(0, limit)
        .map(v => ({
          id: v.id,
          title: v.title,
          url: `https://youtube.com/watch?v=${v.id}`,
          thumbnail: v.thumbnail?.url || null,
          duration: v.durationInSec ? this._formatDuration(v.durationInSec) : 'Unknown',
          views: v.views ? v.views.toLocaleString() : 'Unknown',
          author: v.channel?.name || 'Unknown',
          description: v.description || '',
          uploadedAt: v.uploadedAt || 'Unknown',
        }));
      logger.success(`[YouTube] Found ${videos.length} videos`);
      return { query, totalResults: videos.length, videos };
    } catch (error) {
      logger.error(`[YouTube Search] Error: ${error.message}`);
      throw error;
    }
  }

  async downloadMp3(query, baseUrl = 'http://localhost:3000') {
    let cookiePath = null;
    try {
      logger.info(`[YouTube] Fetching MP3 for: ${query}`);
      if (!hasCookies()) logger.warn('[YouTube] No cookies — set YOUTUBE_COOKIES_B64 for cloud servers');

      let videoUrl = query;
      let videoInfo = null;
      if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
        const sr = await this.searchVideos(query, 1);
        if (!sr.videos.length) throw new NotFoundError('Video not found');
        videoInfo = sr.videos[0];
        videoUrl = videoInfo.url;
      }

      logger.info(`[YouTube] Downloading MP3 from: ${videoUrl}`);
      cookiePath = writeCookieToTmp();
      const baseOpts = getBaseOptions(cookiePath);

      let videoMetadata = {};
      try {
        const metadata = await youtubedl(videoUrl, { ...baseOpts, dumpJson: true, quiet: true });
        videoMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
      } catch (e) {
        logger.warn(`[YouTube] Metadata fetch failed: ${e.message}`);
      }

      const cleanFilename = sanitizeFilename(videoMetadata.title || videoInfo?.title || 'audio', 'mp3');
      const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp3$/, ''));

      await youtubedl(videoUrl, {
        ...baseOpts,
        extractAudio: true,
        audioFormat: 'mp3',
        audioQuality: '192',
        output: outputBase,
        quiet: false,
      });

      const filepath = `${outputBase}.mp3`;
      if (!fs.existsSync(filepath)) throw new AppError('MP3 file was not created', 502);

      const stats = fs.statSync(filepath);
      logger.success(`[YouTube] MP3 ready: ${cleanFilename}`);
      return {
        title: videoMetadata.title || videoInfo?.title || 'Audio',
        download: `${baseUrl}/download/${cleanFilename}`,
        format: 'audio/mpeg',
        fileSize: Math.round(stats.size / 1024) + ' KB',
        duration: videoMetadata.duration ? this._formatDuration(videoMetadata.duration) : (videoInfo?.duration || 'Unknown'),
        author: videoMetadata.uploader || videoInfo?.author || 'Unknown',
        thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (error) {
      logger.error(`[YouTube MP3] Error: ${error.message}`);
      if (this._isBotBlock(error.message)) {
        throw new AppError('YouTube is blocking this server. Set YOUTUBE_COOKIES_B64 with valid browser cookies.', 403);
      }
      throw error;
    } finally {
      cleanupCookies(cookiePath);
    }
  }

  async downloadMp4(query, baseUrl = 'http://localhost:3000') {
      let cookiePath = null;
      try {
        logger.info(`[YouTube] Fetching MP4 for: ${query}`);
        if (!hasCookies()) logger.warn('[YouTube] No cookies — set YOUTUBE_COOKIES_B64 for cloud servers');

        let videoUrl = query;
        let videoInfo = null;
        if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
          const sr = await this.searchVideos(query, 1);
          if (!sr.videos.length) throw new NotFoundError('Video not found');
          videoInfo = sr.videos[0];
          videoUrl = videoInfo.url;
        }

        logger.info(`[YouTube] Downloading MP4 from: ${videoUrl}`);
        cookiePath = writeCookieToTmp();
        const baseOpts = getBaseOptions(cookiePath);

        let videoMetadata = {};
        try {
          const metadata = await youtubedl(videoUrl, { ...baseOpts, dumpJson: true, quiet: true });
          videoMetadata = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
        } catch (e) {
          logger.warn(`[YouTube] Metadata fetch failed: ${e.message}`);
        }

        const cleanFilename = sanitizeFilename(videoMetadata.title || videoInfo?.title || 'video', 'mp4');
        const outputBase = path.join(DOWNLOAD_DIR, cleanFilename.replace(/\.mp4$/, ''));

        const downloadParams = {
          format: 'bestvideo+bestaudio/best',
          mergeOutputFormat: 'mp4',
          output: outputBase,
          quiet: false,
          postprocessorArgs: 'ffmpeg:-c:v copy -c:a aac',
        };

        try {
          // PERCOBAAN 1: Tanpa Proxy
          await youtubedl(videoUrl, { ...baseOpts, ...downloadParams });
        } catch (error) {
          // PERCOBAAN 2: Jika diblokir, coba pakai Proxy Tercepat
          if (this._isBotBlock(error.message)) {
            logger.warn('[YouTube] Terdeteksi blokir, mencoba mencari proxy...');
            const bestProxy = await getBestProxy(); // Fungsi tester yang kita buat tadi

            if (bestProxy) {
              logger.info(`[YouTube] Retrying download with proxy: ${bestProxy}`);
              await youtubedl(videoUrl, { 
                ...baseOpts, 
                ...downloadParams, 
                proxy: bestProxy,
                socketTimeout: 30 // Tambah timeout karena proxy gratis lambat
              });
            } else {
              throw error; // Jika tidak ada proxy hidup, lempar error asli
            }
          } else {
            throw error;
          }
        }

      const filepath = this._findOutputFile(outputBase, ['mp4', 'mkv', 'webm']);
      if (!filepath) throw new AppError('Video file was not created', 502);

      const stats = fs.statSync(filepath);
      const actualFilename = path.basename(filepath);
      logger.success(`[YouTube] MP4 ready: ${actualFilename}`);

      return {
        title: videoMetadata.title || videoInfo?.title || 'Video',
        download: `${baseUrl}/download/${actualFilename}`,
        format: 'video/mp4',
        fileSize: Math.round(stats.size / (1024 * 1024) * 100) / 100 + ' MB',
        duration: videoMetadata.duration ? this._formatDuration(videoMetadata.duration) : (videoInfo?.duration || 'Unknown'),
        author: videoMetadata.uploader || videoInfo?.author || 'Unknown',
        thumbnail: videoMetadata.thumbnail || videoInfo?.thumbnail || null,
        status: 'success',
      };
    } catch (error) {
      logger.error(`[YouTube MP4] Error: ${error.message}`);
      if (this._isBotBlock(error.message)) {
        throw new AppError('YouTube is blocking this server even with proxy. Refresh cookies.', 403);
      }
      throw new AppError(`Download failed: ${error.message}`, 502);
    } finally {
      cleanupCookies(cookiePath);
    }
  }

  _findOutputFile(base, exts = ['mp4', 'mkv', 'webm']) {
    for (const ext of exts) {
      const f = `${base}.${ext}`;
      if (fs.existsSync(f)) return f;
    }
    return null;
  }

  _isBotBlock(message = '') {
    return ['Sign in to confirm', 'bot', 'HTTP Error 429', 'HTTP Error 403',
      'cookies', 'age-restricted', 'not available'].some(
      s => message.toLowerCase().includes(s.toLowerCase())
    );
  }

  _formatDuration(seconds) {
    if (!seconds) return 'Unknown';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (h > 0) parts.push(`${h} jam`);
    if (m > 0) parts.push(`${m} menit`);
    if (s > 0 || !parts.length) parts.push(`${s} detik`);
    return parts.join(', ');
  }
}

module.exports = new YouTubeService();