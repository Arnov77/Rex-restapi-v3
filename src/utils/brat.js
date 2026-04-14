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
  try {
    const page = await browser.newPage({
      viewport: { width: 900, height: 600 },
    });

    await page.goto('https://bratify.vercel.app/', { waitUntil: 'networkidle' });
    await applyPreset(page, presetValue, bgColor, textColor);

    const words = text.split(' ');
    const frames = [];

    for (let i = 0; i < words.length; i += 1) {
      const partialText = words.slice(0, i + 1).join(' ');
      await fillBratText(page, partialText);
      await page.waitForTimeout(300);
      frames.push(await page.locator('section.shadow').screenshot());
    }

    return createGIF(frames);
  } finally {
    await browser.close();
  }
}

module.exports = { generateBrat, generateBratVideo };
