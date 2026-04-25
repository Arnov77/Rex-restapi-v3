const fs = require('fs');
const path = require('path');
const { withContext } = require('../../../shared/browser/browserManager');
const { convertColor } = require('./color');
const { createGIF } = require('../../../shared/media/gif');
const logger = require('../../../shared/utils/logger');

async function applyPreset(page, presetValue, bgColor, textColor) {
  await page.waitForSelector('#preset');

  if (bgColor && textColor) {
    await page.selectOption('#preset', 'custom');
    await page.fill('input#background', convertColor(bgColor));
    await page.fill('input#foreground', convertColor(textColor));
    return;
  }

  await page.selectOption('#preset', presetValue);
}

async function fillBratText(page, text) {
  const textInput = await page.locator('div[contenteditable="true"].album-art');
  await textInput.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  await textInput.type(text);
}

async function generateBrat(text, presetValue = 'brat', bgColor = null, textColor = null) {
  return withContext(
    async (context) => {
      const page = await context.newPage();
      await page.goto('https://bratify.vercel.app/', { waitUntil: 'networkidle' });
      await applyPreset(page, presetValue, bgColor, textColor);
      await fillBratText(page, text);
      await page.waitForTimeout(1000);

      const downloadPath = `/tmp/brat-${Date.now()}.png`;
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.click('section.export button:first-child'),
      ]);

      await download.saveAs(downloadPath);
      const buffer = fs.readFileSync(downloadPath);
      fs.unlinkSync(downloadPath);

      return buffer;
    },
    { acceptDownloads: true, viewport: { width: 900, height: 600 } }
  );
}

async function generateBratVideo(text, presetValue = 'brat', bgColor = null, textColor = null) {
  return withContext(
    async (context) => {
      const tempDownloadDir = path.join(__dirname, `../../../../temp/brat-downloads-${Date.now()}`);
      fs.mkdirSync(tempDownloadDir, { recursive: true });

      const page = await context.newPage();
      await page.setViewportSize({ width: 900, height: 600 });

      await page.goto('https://bratify.vercel.app/', { waitUntil: 'networkidle' });
      await applyPreset(page, presetValue, bgColor, textColor);

      const words = text.split(' ');
      const frames = [];

      const textInput = await page.locator('div[contenteditable="true"].album-art');
      await textInput.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(500);

      // Frame 0: blank canvas before any words have been typed.
      let downloadPromise = page.waitForEvent('download');
      await page.click('section.export button:first-child');
      let download = await downloadPromise;
      let framePath = path.join(tempDownloadDir, `frame-000.png`);
      await download.saveAs(framePath);
      await page.waitForTimeout(200);
      if (fs.existsSync(framePath)) {
        const frameBuffer = fs.readFileSync(framePath);
        frames.push(frameBuffer);
        logger.info(`[Brat] Frame 0 (empty) saved: ${frameBuffer.length} bytes`);
      }

      for (let i = 0; i < words.length; i += 1) {
        const partialText = words.slice(0, i + 1).join(' ');
        await fillBratText(page, partialText);
        await page.waitForTimeout(1000);

        downloadPromise = page.waitForEvent('download');
        await page.click('section.export button:first-child');
        download = await downloadPromise;

        framePath = path.join(tempDownloadDir, `frame-${(i + 1).toString().padStart(3, '0')}.png`);
        await download.saveAs(framePath);
        await page.waitForTimeout(200);

        if (fs.existsSync(framePath)) {
          const frameBuffer = fs.readFileSync(framePath);
          frames.push(frameBuffer);
          logger.info(`[Brat] Frame ${i + 1} saved: ${frameBuffer.length} bytes`);
        } else {
          throw new Error(`Failed to save frame ${i + 1}`);
        }
      }

      const gifBuffer = await createGIF(frames);
      fs.rmSync(tempDownloadDir, { recursive: true, force: true });

      return gifBuffer;
    },
    { acceptDownloads: true, viewport: { width: 900, height: 600 } }
  );
}

module.exports = { generateBrat, generateBratVideo };
