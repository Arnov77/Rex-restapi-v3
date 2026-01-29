const express = require('express');
const { search, ytmp3 } = require('@vreden/youtube_scraper');
const router = express.Router();
const config = require('../../config');

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.query) {
      return res.status(400).json({ status: 400, message: "Required parameter 'query'" });
    }

    let videoUrl = obj.query.trim();
    
    // Jika input bukan URL, lakukan pencarian
    if (!videoUrl.startsWith('http')) {
      const searchResult = await search(videoUrl);
      if (!searchResult.status || searchResult.results.length === 0) {
        return res.status(404).json({ status: 404, message: 'Video tidak ditemukan.' });
      }
      videoUrl = searchResult.results[0].url; // Ambil URL video pertama
    }

    // Dapatkan audio dari video
    const downloadResult = await ytmp3(videoUrl);
    if (!downloadResult.status || !downloadResult.download.url) {
      return res.status(500).json({ status: 500, message: 'Gagal mendapatkan audio.' });
    }

    // Format response
    res.json({
      status: 200,
      creator: config.creator, // Bisa diubah dari konfigurasi
      data: downloadResult.download.availableQuality.map(q => ({
        quality: `${q}kbps`,
        title: downloadResult.metadata.title,
        downloadUrl: downloadResult.download.url,
        format: "audio",
      })),
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ status: 500, message: 'Internal Server Error' });
  }
});

module.exports = router;
