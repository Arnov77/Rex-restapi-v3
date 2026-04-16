const fs = require('fs');
const { getBrowser } = require('./browser');
const { convertColor } = require('./color');
const { createGIF } = require('./gif');

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
  const browser = await getBrowser();
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });

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
  } finally {
    await browser.close();
  }
}

async function generateBratVideo(text, presetValue = 'brat', bgColor = null, textColor = null) {
  const browser = await getBrowser();
  const path = require('path');
  const fs = require('fs');
  
  try {
    // Create temp download dir for this session
    const tempDownloadDir = path.join(__dirname, `../../temp/brat-downloads-${Date.now()}`);
    fs.mkdirSync(tempDownloadDir, { recursive: true });

    // Create new context with download handling
    const context = await browser.newContext({
      acceptDownloads: true,
    });

    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });

    await page.goto('https://bratify.vercel.app/', { waitUntil: 'networkidle' });
    await applyPreset(page, presetValue, bgColor, textColor);

    const words = text.split(' ');
    const frames = [];

    // Clear text field first to ensure blank
    const textInput = await page.locator('div[contenteditable="true"].album-art');
    await textInput.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500); // Wait for clear to render

    // Frame 0: Empty/blank
    let downloadPromise = page.waitForEvent('download');
    await page.click('section.export button:first-child');
    let download = await downloadPromise;
    let framePath = path.join(tempDownloadDir, `frame-000.png`);
    await download.saveAs(framePath);
    await page.waitForTimeout(200);
    if (fs.existsSync(framePath)) {
      const frameBuffer = fs.readFileSync(framePath);
      frames.push(frameBuffer);
      console.log(`[Brat] Frame 0 (empty) saved: ${frameBuffer.length} bytes`);
    }

    // Frames 1+: Progressive text
    for (let i = 0; i < words.length; i += 1) {
      const partialText = words.slice(0, i + 1).join(' ');
      await fillBratText(page, partialText);
      await page.waitForTimeout(1000); // Longer wait for render to complete

      // Click download button and capture the download
      downloadPromise = page.waitForEvent('download');
      await page.click('section.export button:first-child');
      download = await downloadPromise;

      // Save downloaded file
      framePath = path.join(tempDownloadDir, `frame-${(i + 1).toString().padStart(3, '0')}.png`);
      await download.saveAs(framePath);
      
      // Wait for file to be fully written to disk
      await page.waitForTimeout(200);
      
      // Verify file exists and read into buffer
      if (fs.existsSync(framePath)) {
        const frameBuffer = fs.readFileSync(framePath);
        frames.push(frameBuffer);
        console.log(`[Brat] Frame ${i + 1} saved: ${frameBuffer.length} bytes`);
      } else {
        throw new Error(`Failed to save frame ${i + 1}`);
      }
    }

    // Create GIF from all downloaded frames
    const gifBuffer = await createGIF(frames);

    // Cleanup temp downloads
    fs.rmSync(tempDownloadDir, { recursive: true, force: true });
    
    // Close context
    await context.close();

    return gifBuffer;
  } finally {
    await browser.close();
  }
}

module.exports = { generateBrat, generateBratVideo };
