const sharp = require('sharp');
const browserManager = require('../../../shared/browser/browserManager');
const logger = require('../../../shared/utils/logger');

const MIME_TYPES = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

// Playwright's page.screenshot() only supports png|jpeg. WebP is produced by
// capturing PNG first and re-encoding with sharp.
const PLAYWRIGHT_NATIVE_FORMATS = new Set(['png', 'jpeg']);

/**
 * Takes a screenshot of the given URL using the shared Playwright Chromium instance.
 * @param {object} opts
 * @param {string}  opts.url       - Full http/https URL to capture.
 * @param {number}  opts.width     - Viewport width in pixels (default 1280).
 * @param {number}  opts.height    - Viewport height in pixels (default 720).
 * @param {boolean} opts.fullPage  - Capture entire scrollable page (default false).
 * @param {string}  opts.format    - Image format: png | jpeg | webp (default png).
 * @param {number}  opts.quality   - JPEG/WebP quality 1-100 (default 85; ignored for png).
 * @param {number}  opts.waitFor   - Extra ms to wait after load (default 0).
 * @param {boolean} opts.darkMode  - Emulate prefers-color-scheme: dark (default false).
 * @returns {{ buffer: Buffer, mimeType: string, format: string }}
 */
async function capture({ url, width, height, fullPage, format, quality, waitFor, darkMode }) {
  logger.info(
    `[screenshot] capturing ${url} (${width}x${height}, ${format}, fullPage=${fullPage})`
  );

  const buffer = await browserManager.withPage(
    async (page) => {
      // Emulate dark mode if requested
      if (darkMode) {
        await page.emulateMedia({ colorScheme: 'dark' });
      }

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      } catch (_err) {
        // Fallback: if networkidle times out, try domcontentloaded
        logger.warn(
          `[screenshot] networkidle timeout for ${url}, falling back to domcontentloaded`
        );
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      }

      // Optional extra wait for dynamic content / animations
      if (waitFor > 0) {
        await page.waitForTimeout(waitFor);
      }

      const captureType = PLAYWRIGHT_NATIVE_FORMATS.has(format) ? format : 'png';
      const screenshotOptions = {
        type: captureType,
        fullPage,
        ...(captureType === 'jpeg' ? { quality } : {}),
      };

      return page.screenshot(screenshotOptions);
    },
    {
      viewport: { width, height },
    }
  );

  let outputBuffer = buffer;
  if (format === 'webp') {
    outputBuffer = await sharp(buffer).webp({ quality }).toBuffer();
  }

  logger.info(`[screenshot] done — ${outputBuffer.length} bytes`);
  return { buffer: outputBuffer, mimeType: MIME_TYPES[format], format };
}

module.exports = { capture };
