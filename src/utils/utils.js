const playwright = require('playwright');
const axios = require('axios');
const FormData = require('form-data');

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
      await page.goto("https://www.bratgenerator.com/", { timeout: 60000, waitUntil: "load" });
      await page.click('#toggleButtonWhite');
      await page.locator('#textInput').fill(text);
      const screenshotBuffer = await page.locator('#textOverlay').screenshot();
      return await utils.uploadToTmpfiles(screenshotBuffer, `${utils.randomName('.jpg')}`);
    } finally {
      if (browser) await browser.close();
    }
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
