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

blackenWaifuFromURL: async (imageUrl) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  // Fetch image and encode to base64
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const base64Image = Buffer.from(response.data).toString('base64');

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          { text: "Ubah karakter ini menjadi versi berkulit hitam, dengan gaya natural dan realistis." },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image,
            }
          }
        ],
      },
    ],
    generationConfig: {
      temperature: 1,
      topP: 0.95,
      topK: 40,
      responseMimeType: "image/jpeg",
    },
  });

  const imagePart = result.response.candidates[0].content.parts.find(p => p.inlineData);
  const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
  return await utils.uploadToTmpfiles(imageBuffer, utils.randomName('.jpg'));
 },
};

module.exports = utils;
