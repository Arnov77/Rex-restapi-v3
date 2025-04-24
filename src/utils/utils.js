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
  getBrowser: async (...opts) => {
    const proxiesPath = path.join(__dirname, 'proxies.txt');
    let proxyOption;

    if (fs.existsSync(proxiesPath)) {
      const proxies = fs.readFileSync(proxiesPath, 'utf-8')
        .split('\n')
        .map(p => p.trim())
        .filter(p => p);

      if (proxies.length > 0) {
        const randomProxy = `http://${proxies[Math.floor(Math.random() * proxies.length)]}`;
        console.log('Pakai proxy:', randomProxy);
        proxyOption = { server: randomProxy };
      } else {
        console.warn('proxies.txt kosong. Lanjut tanpa proxy.');
      }
    } else {
      console.warn('proxies.txt tidak ditemukan. Lanjut tanpa proxy.');
    }

    const launchOptions = {
      args: [
        '--incognito',
        '--single-process',
        '--no-sandbox',
        '--no-zygote',
        '--no-cache',
      ],
      executablePath: process.env.CHROME_BIN,
      headless: true,
      ...opts,
    };

    if (proxyOption) {
      launchOptions.proxy = proxyOption;
    }

    return playwright.chromium.launch(launchOptions);
  },

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
      const page = await browser.newPage({
        viewport: { width: 900, height: 573 }
      });      
      await page.goto("https://www.bratgenerator.com/");
      
      const acceptButton = page.locator('#onetrust-accept-btn-handler');
      if ((await acceptButton.count()) > 0 && await acceptButton.isVisible()) {
        await acceptButton.click();
        await page.waitForTimeout(500);
      }
  
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
      const page = await browser.newPage({
        viewport: { width: 900, height: 573 }
      });   
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

      const acceptButton = page.locator('#onetrust-accept-btn-handler');
      if ((await acceptButton.count()) > 0 && await acceptButton.isVisible()) {
        await acceptButton.click();
        await page.waitForTimeout(500);
      }
  
      await page.fill('#url', videoUrl);
      await page.click('#send');
  
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

instagramDownloader: async (videoUrl) => {
  const browser = await utils.getBrowser();
  try {
    const page = await browser.newPage();
    await page.goto('https://snapsave.app/id/download-video-instagram', { waitUntil: 'domcontentloaded' });

    await page.fill('#url', videoUrl);
    await page.click('button[type="submit"]');

    await page.waitForSelector('#download-section a[href^="https"]', { timeout: 20000 });

    let thumbnail = null;
    try {
      await page.waitForSelector('#download-section .download-items__thumb.video img', { timeout: 10000 });
      thumbnail = await page.$eval('#download-section .download-items__thumb.video img', img => img.src);
    } catch (e) {
      console.warn('Thumbnail tidak ditemukan:', e.message);
    }

    const links = await page.$$eval(
      '#download-section a[href^="https"]',
      anchors => anchors.map(a => ({
        text: a.innerText.trim(),
        url: a.href
      })).filter(a =>
        a.url &&
        !a.url.includes('play.google.com') &&
        !/download with app/i.test(a.text)
      )
    );

    if (!links.length) throw new Error('Link unduhan tidak ditemukan.');

    return links.map(link => ({
      text: link.text,
      thumbnail,
      url: link.url
    }));
    
  } finally {
    await browser.close();
  }
},

generateQuoteImage: async (name, message, avatarUrl) => {
  const browser = await utils.getBrowser();
  try {
    const page = await browser.newPage();

    const defaultAvatar = 'https://i.ibb.co.com/dwTRp2SF/images-1.jpg';
    avatarUrl = avatarUrl?.trim() ? avatarUrl : defaultAvatar;

    const html = `
      <html>
        <head>
          <style>
            html, body {
              margin: 0;
              padding: 0;
              display: inline-block;
            }
            body {
              margin: 0;
              padding: 40px;
              font-family: 'Segoe UI', sans-serif;
              background:rgba(255, 255, 255, 0);
            }
            .chat-container {
              display: flex;
              align-items: flex-start;
              max-width: 600px;
            }
            .avatar {
              width: 60px;
              height: 60px;
              border-radius: 50%;
              object-fit: cover;
              margin-right: 12px;
              flex-shrink: 0;
            }
            .bubble {
              background: #fff;
              border-radius: 18px;
              padding: 14px 16px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.08);
              display: inline-block;
              max-width: 100%;
            }
            .name {
              font-weight: 600;
              font-size: 25px;
              margin-bottom: 4px;
              color:rgb(255, 136, 0);
            }
            .message {
              font-size: 25px;
              color: #111;
              white-space: pre-wrap;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="chat-container">
            <img class="avatar" src="${avatarUrl}" />
            <div class="bubble">
              <div class="name">${name}</div>
              <div class="message">${message}</div>
            </div>
          </div>
        </body>
      </html>
    `;
    await page.setContent(html, { waitUntil: 'networkidle' });
    const element = await page.$('.chat-container');
    const buffer = await element.screenshot({ omitBackground: true });

    return buffer;
  } finally {
    await browser.close();
  }
}

};

module.exports = utils;
