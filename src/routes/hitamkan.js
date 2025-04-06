const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

async function downloadToLocal(imageUrl) {
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const filename = path.join('/tmp', `${uuidv4()}.jpg`);
  fs.writeFileSync(filename, response.data);
  return filename;
}

async function blackWaifu(req, res) {
  const imageUrl = req.query.image;
  if (!imageUrl) return res.status(400).json({ error: 'Parameter image wajib diisi.' });

  let browser;
  try {
    const localFilePath = await downloadToLocal(imageUrl);

    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.goto('https://negro.consulting/', { waitUntil: 'networkidle2' });

    const input = await page.$('input[type=file]');
    await input.uploadFile(localFilePath);

    await page.waitForSelector('a[download]', { timeout: 30000 });
    const resultUrl = await page.$eval('a[download]', el => el.href);

    fs.unlinkSync(localFilePath); // hapus file setelah diproses
    await browser.close();

    return res.json({ result: resultUrl });

  } catch (err) {
    console.error(err);
    if (browser) await browser.close();
    return res.status(500).json({ error: 'Gagal memproses gambar.' });
  }
}

module.exports = { blackWaifu };
