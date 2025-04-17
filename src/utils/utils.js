const { GoogleGenerativeAI } = require('@google/generative-ai');
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
      headless: false,
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
      
      const acceptButton = page.locator('#onetrust-accept-btn-handler');
      if ((await acceptButton.count()) > 0 && await acceptButton.isVisible()) {
        await acceptButton.click();
        await page.waitForTimeout(500);
      }
  
      await page.click('#toggleButtonWhite');
      await page.locator('#textInput').fill(text);
await page.waitForTimeout(500);

const box = await page.locator('#textOverlay').boundingBox();
console.log(`Resolusi elemen: ${box.width}x${box.height}`);

const screenshotBuffer = await page.locator('#textOverlay').screenshot();

const sizeOf = require('image-size');
const dimensions = sizeOf(screenshotBuffer);
console.log(`Resolusi screenshot: ${dimensions.width}x${dimensions.height}`);

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

      const acceptButton = page.locator('#onetrust-accept-btn-handler');
      if ((await acceptButton.count()) > 0 && await acceptButton.isVisible()) {
        await acceptButton.click();
        await page.waitForTimeout(500);
      }

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

  facebookDownloader: async (videoUrl) => {
    const browser = await utils.getBrowser();
    try {
      const page = await browser.newPage();
      await page.goto('https://snapsave.app/id', { waitUntil: 'domcontentloaded' });
  
      await page.fill('#url', videoUrl);
      await page.click('button[type="submit"]');
  
      // Tunggu hasil unduhan muncul
      await page.waitForSelector('#download-section a[href^="https"]', { timeout: 20000 });
  
      // Ambil semua link unduhan
      const downloadLinks = await page.$$eval(
        '#download-section table tbody tr',
        rows => rows.map(row => {
          const qualityText = row.querySelector('td.video-quality')?.innerText.trim();
          const quality = qualityText?.match(/\(([^)]+)\)/)?.[1];
          const url = row.querySelector('td:nth-child(3) a')?.href;
          return { quality, url };
        }).filter(item => item.url)
      );
      
      if (!downloadLinks.length) throw new Error('Link unduhan tidak ditemukan.');
      return downloadLinks;
    } finally {
      await browser.close();
    }
  },  
  instagramDownloader: async (url) => {
    try {
      const res = await axios.post('https://api.fastdl.app/api/ajaxSearch', {
        q: url
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://fastdl.app',
          'Referer': 'https://fastdl.app/'
        }
      });

      const result = res.data;

      if (!result || !result.medias || result.medias.length === 0) {
        throw new Error('Media tidak ditemukan atau URL tidak valid.');
      }

      return {
        status: 200,
        result: result.medias.map(media => ({
          quality: media.quality || 'default',
          type: media.extension,
          url: media.url
        }))
      };
    } catch (err) {
      return {
        status: 500,
        message: utils.getError(err)
      };
    }
  },

};

module.exports = utils;
