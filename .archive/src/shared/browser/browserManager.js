const fs = require('fs');
const path = require('path');
const playwright = require('playwright');
const { env } = require('../../../config');
const logger = require('../utils/logger');

// One Chromium instance is shared across the whole app. Per-request isolation
// is provided via `browser.newContext()` (incognito profile + no shared
// cookies). Replaces the previous pattern of launching+closing Chromium for
// every brat/quote request, which leaked ~1–2s and several hundred MB of RAM
// per call.

let instance = null;
let launching = null;

function readProxyOption() {
  const proxiesPath = path.join(__dirname, '../../../proxies.txt');
  if (!fs.existsSync(proxiesPath)) return undefined;
  const proxies = fs
    .readFileSync(proxiesPath, 'utf-8')
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (proxies.length === 0) return undefined;
  const picked = proxies[Math.floor(Math.random() * proxies.length)];
  logger.info(`[browser] using proxy from proxies.txt`);
  return { server: picked.startsWith('http') ? picked : `http://${picked}` };
}

async function launch() {
  logger.info('[browser] launching shared playwright chromium');
  const launchOptions = {
    args: ['--no-sandbox', '--no-zygote', '--disable-dev-shm-usage'],
    executablePath: env.CHROME_BIN,
    headless: true,
  };
  const proxy = readProxyOption();
  if (proxy) launchOptions.proxy = proxy;

  const browser = await playwright.chromium.launch(launchOptions);
  // Auto-recover from upstream Chromium crashes — the next caller will get
  // a freshly launched browser instead of a dead handle.
  browser.on('disconnected', () => {
    logger.warn('[browser] shared chromium disconnected, will relaunch on next call');
    instance = null;
  });
  return browser;
}

async function getBrowser() {
  if (instance) return instance;
  if (!launching) {
    launching = launch().then((b) => {
      instance = b;
      launching = null;
      return b;
    });
  }
  return launching;
}

// Most callers want a fresh isolated context (cookies, viewport) per request
// and don't care about the underlying browser handle.
async function withContext(fn, contextOptions = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 900, height: 600 },
    ...contextOptions,
  });
  try {
    return await fn(context);
  } finally {
    await context.close().catch((e) => logger.warn(`[browser] context.close: ${e.message}`));
  }
}

// Convenience wrapper for the common case "I just want one page".
async function withPage(fn, contextOptions = {}) {
  return withContext(async (context) => {
    const page = await context.newPage();
    return fn(page, context);
  }, contextOptions);
}

async function shutdown() {
  if (!instance) return;
  logger.info('[browser] closing shared chromium');
  try {
    await instance.close();
  } catch (e) {
    logger.error(`[browser] close error: ${e.message}`);
  }
  instance = null;
}

module.exports = { getBrowser, withContext, withPage, shutdown };
