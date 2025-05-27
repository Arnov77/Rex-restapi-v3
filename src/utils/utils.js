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
      const response = await axios.post('http://tmpfiles.org/api/v1/upload', form, {
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

generateMemeImage: async (imageUrl, topText = '', bottomText = '') => {
  const browser = await utils.getBrowser();
  try {
    const page = await browser.newPage();

    const html = `
      <html>
        <head>
          <style>
            @import url('https://fonts.cdnfonts.com/css/impact');
            body {
              margin: 0;
              padding: 0;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              background: transparent;
            }
            .container {
              position: relative;
              display: inline-block;
            }
            img {
              max-width: 600px;
              width: 100%;
              height: auto;
              display: block;
            }
            .text {
              position: absolute;
              left: 50%;
              transform: translateX(-50%);
              color: white;
              font-family: Impact, sans-serif;
              font-size: 65px;
              text-shadow: 2px 2px 4px #000;
              -webkit-text-stroke: 1.5px black; /* Tambahan outline */
              text-align: center;
              width: 90%;
              line-height: 1.2;
              word-break: break-word;
            }
            .top {
              top: 5%;
            }
            .bottom {
              bottom: 5%;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <img src="${imageUrl}" />
            <div class="text top">${topText.toUpperCase()}</div>
            <div class="text bottom">${bottomText.toUpperCase()}</div>
          </div>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: 'networkidle' });
    const img = await page.$('img');
    const boundingBox = await img.boundingBox();
    await page.setViewportSize({
      width: Math.ceil(boundingBox.width),
      height: Math.ceil(boundingBox.height),
    });
    
    const container = await page.$('.container');
    const buffer = await container.screenshot({ omitBackground: true });

    return buffer;
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
              padding-bottom: 60px;
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
              position: relative;
              background:rgb(255, 255, 255);
              border-radius: 0px 24px 24px 24px;
              padding: 10px 14px;
              color: white;
              max-width: 80%;
              box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
            }

            .bubble::after {
              content: '';
              position: absolute;
              left: -10px; /* sesuaikan posisi ke kiri */
              top: 0;
              width: 0;
              height: 0;
              border: 10px solid transparent;
              border-top-color:rgb(255, 255, 255); /* warna sama seperti bubble */
              border-bottom: 0;
              border-right: 0;
              margin-bottom: -1px;
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
},

promotionDetector: async (text) => {
  const apiKey = process.env.GEMINI_API_KEY;
  
  // Membersihkan teks input dari karakter khusus yang mungkin mengganggu
  const cleanedText = text.trim().replace(/"/g, "'");
  
  const prompt = `
  Analisa secara kritis apakah teks berikut termasuk pesan promosi atau tidak dengan ketentuan:
  
  Klasifikasi sebagai PROMOSI jika:
  - Mengandung penawaran produk/jasa (diskon, harga spesial, dll)
  - Mengajak bergabung/bergabung ke komunitas/server
  - Mempromosikan bisnis/usaha tertentu
  - Mengandung link/URL yang mengarah ke penjualan
  - Mengandung ajakan untuk membeli/menggunakan sesuatu
  
  Klasifikasi sebagai BUKAN PROMOSI jika:
  - Hanya menyebut kata "promosi" secara sarkastis/komentar
  - Membahas promosi secara umum tanpa mempromosikan sesuatu
  - Konten biasa/diskusi umum tanpa unsur penjualan
  - Hanya menyebut merek tanpa maksud promosi
  - Konten edukatif/informatif tentang produk tanpa ajakan beli
  
  Berikan analisis dengan format:
  [Persentase]% - [Penjelasan]
  
  Contoh jawaban:
  5% - Hanya menyebut merek dalam konteks diskusi biasa
  90% - Mengandung penawaran produk dengan harga spesial
  
  Teks yang dianalisis:
  "${cleanedText}"
  `;
    
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }]
      }),
      timeout: 10000 // tambahkan timeout untuk menghindari hanging
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const textResponse = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    // Improved regex pattern to handle various response formats
    const match = textResponse?.match(/(\d{1,3})%\s*[-:]\s*(.+)/i);
    if (!match) {
      console.error('Unexpected API response format:', textResponse);
      return { percentage: 0, reason: "Format respons tidak dikenali" };
    }

    const percentage = Math.min(100, Math.max(0, parseInt(match[1], 10))); // Ensure percentage is between 0-100
    const reason = match[2].trim();

    // Additional validation for common false positives
    const falsePositiveKeywords = ['tidak ada promosi', 'bukan promosi', 'diskusi biasa', 'hanya menyebut'];
    const isLikelyFalsePositive = falsePositiveKeywords.some(keyword => 
      reason.toLowerCase().includes(keyword)
    );

    const adjustedPercentage = isLikelyFalsePositive 
      ? Math.max(0, percentage - 20) // Reduce percentage for likely false positives
      : percentage;

    return { 
      percentage: adjustedPercentage, 
      reason,
      rawResponse: textResponse // Untuk debugging
    };
    
  } catch (error) {
    console.error('Error in promotion detection:', error);
    return { 
      percentage: 0, 
      reason: "Error dalam memproses permintaan",
      error: error.message 
    };
  }
},

};

module.exports = utils;
