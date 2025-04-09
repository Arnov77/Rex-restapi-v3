const express = require('express');
const router = express.Router();
const { tiktok } = require('majidapi/modules/social'); // Perbaiki impor
const config = require('../../config'); // Import config.js

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.url) {
      return res.status(400).json({ status: 400, message: "Parameter 'url' diperlukan" });
    }

    const url = obj.url.trim();
    const result = await tiktok({
      method: 'download',
      url: url,
    });

    if (!result || !result.music) {
      return res.status(404).json({ status: 404, message: 'Audio tidak ditemukan atau tidak bisa diunduh.' });
    }

    res.json({
      status: 200,
      creator: config.creator,
      data: {
        musicUrl: result.music,
        title: result.title,
        author: {
          id: result.author.id,
          uniqueId: result.author.unique_id,
          nickname: result.author.nickname,
        },
      },
    });
  } catch (error) {
    console.error(error.message);
    res.status(500).json({ status: 500, message: error.message || 'Terjadi kesalahan' });
  }
});

module.exports = router;