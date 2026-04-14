const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

async function getBrowser(...opts) {
  const proxiesPath = path.join(__dirname, 'proxies.txt');
  let proxyOption;

  if (fs.existsSync(proxiesPath)) {
    const proxies = fs.readFileSync(proxiesPath, 'utf-8')
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);

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
}

module.exports = { getBrowser };
