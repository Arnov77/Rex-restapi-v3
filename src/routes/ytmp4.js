const express = require('express');
const router = express.Router();
const { ytmp4 } = require('@vreden/youtube_scraper');
const config = require('../../config'); // Import config.js

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.query) {
      return res.status(400).json({ status: 400, message: "Parameter 'query' diperlukan" });
    }

    const query = obj.query.trim();
    const result = await ytmp4(query);

    if (!result.status || !result.download.status) {
      return res.status(404).json({ status: 404, message: 'Video tidak ditemukan atau tidak bisa diunduh.' });
    }

    const { metadata, download } = result;
    const { title } = metadata;
    const availableQualities = download.availableQuality;

    // Format response sesuai permintaan
    const data = availableQualities.map((quality) => ({
      quality: `${quality}p`,
      title,
      downloadUrl: download.url,
      format: 'video',
    }));

    res.json({
      status: 200,
      creator: config.creator, // Ambil dari config.js
      data,
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: 500, message: error.message || 'Terjadi kesalahan' });
  }
});

module.exports = router;
