const playwright = require('playwright');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const GIFEncoder = require('gifencoder');
const path = require('path');
const { createCanvas, loadImage } = require('canvas');
const stream = require('stream');
const { promisify } = require('util');
const pipeline = promisify(stream.pipeline);

const utils = {
  getBrowser: async (...opts) =>
    playwright.chromium.launch({
      args: [
        '--incognito',
        '--single-process',
        '--no-sandbox',
        '--no-zygote',
        '--no-cache',
      ],
      executablePath: process.env.CHROME_BIN, // Gunakan path dari .env
      headless: true,
      ...opts,
    }),

  uploadToTmpfiles: async (fileBuffer, fileName) => {
    const form = new FormData();
    form.append('file', fileBuffer, { filename: fileName });

    try {
      const response = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: { ...form.getHeaders() },
      });

      if (response.data.status === 'success') {
        return response.data.data.url;
      } else {
        throw new Error('Upload gagal: ' + response.data.message);
      }
    } catch (error) {
      throw new Error('Gagal mengunggah ke tmpfiles.org: ' + error.message);
    }
  },

  generateBrat: async (text) => {
    const browser = await utils.getBrowser();
    try {
      const page = await browser.newPage();
      await page.goto("https://www.bratgenerator.com/");
      await page.click('#toggleButtonWhite');
      await page.locator('#textInput').fill(text);
      const screenshotBuffer = await page.locator('#textOverlay').screenshot();
      return await utils.uploadToTmpfiles(screenshotBuffer, `${utils.randomName('.jpg')}`);
    } finally {
      if (browser) await browser.close();
    }
  },

  generateBratVideo: async (text) => {
    const browser = await utils.getBrowser();
    try {
      const page = await browser.newPage();
      await page.goto("https://www.bratgenerator.com/");
      await page.click('#toggleButtonWhite');
      
      const words = text.split(' ');
      let frames = [];
      
      for (let i = 0; i < words.length; i++) {
        const partialText = words.slice(0, i + 1).join(' ');
        await page.locator('#textInput').fill(partialText);
        const screenshotBuffer = await page.locator('#textOverlay').screenshot();
        frames.push(screenshotBuffer);
      }
      
      const gifBuffer = await utils.createGIF(frames);
      return await utils.uploadToTmpfiles(gifBuffer, `${utils.randomName('.gif')}`);
    } finally {
      if (browser) await browser.close();
    }
  },

  generateHitamkanWaifu: async (imageUrl) => {
    const browser = await utils.getBrowser();
    const tempDir = path.join(__dirname, '../../temp');

    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    const imagePath = path.join(tempDir, utils.randomName('.jpg'));

    try {
      // Download gambar dari URL
      const response = await axios.get(imageUrl, { responseType: 'stream' });
      await pipeline(response.data, fs.createWriteStream(imagePath));

      const page = await browser.newPage();
      await page.goto('https://negro.consulting/', { timeout: 60000 });

      // Scroll ke bawah agar input file terlihat
      await page.mouse.wheel({ deltaY: 1000 });
      await page.waitForTimeout(1500); // Biarkan UI terbuka sepenuhnya

      // Buka akses ke input file (remove hidden)
      await page.evaluate(() => {
        const input = document.querySelector('#image-upload');
        input.classList.remove('hidden');
      });

      // Upload file
      const inputFile = await page.$('input#image-upload');
      await inputFile.setInputFiles(imagePath);

      // Tunggu tombol transform muncul dan klik
      await page.waitForSelector('button.bg-pink-500:not([disabled])', { timeout: 30000 });
      await page.click('button.bg-pink-500');

      // Tunggu proses selesai (tombol Save muncul)
      await page.waitForSelector('button.glass-effect', { timeout: 60000 });

      // Ambil canvas hasil hitam
      const canvasElement = await page.$('canvas');
      const resultBuffer = await canvasElement.screenshot();

      // Upload hasil ke tmpfiles
      const uploadedUrl = await utils.uploadToTmpfiles(resultBuffer, utils.randomName('.jpg'));

      // Hapus file temp lokal
      fs.unlinkSync(imagePath);

      return uploadedUrl;

    } catch (err) {
      throw new Error('Gagal memproses gambar: ' + err.message);
    } finally {
      if (browser) await browser.close();
    }
  },
  
  createGIF: async (frames) => {
    const encoder = new GIFEncoder(512, 512);
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(500);
    encoder.setQuality(10);

    const canvas = createCanvas(512, 512);
    const ctx = canvas.getContext('2d');

    for (const frame of frames) {
      const img = await loadImage(frame);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      encoder.addFrame(ctx);
    }

    encoder.finish();
    return encoder.out.getData();
  },

  randomName: (suffix = '') => Math.random().toString(36).slice(2) + suffix,

  getError: (err) => err.message || 'Unknown Error',

  streamToBuffer: async (stream) => {
    return new Promise((resolve, reject) => {
      const chunks = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', (err) => reject(err));
    });
  },
};

module.exports = utils;
