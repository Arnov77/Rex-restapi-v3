const express = require('express');
const router = express.Router();
const { ttdl } = require('ruhend-scraper');
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
    const result = await ttdl(url);

    if (!result || !result.video) {
      return res.status(404).json({ status: 404, message: 'Video tidak ditemukan atau URL tidak valid.' });
    }

    const data = {
      region: result.region,
      title: result.title,
      published: result.published,
      author: {
        name: result.author,
        username: result.username,
        avatar: result.avatar,
      },
      stats: {
        like: result.like,
        comment: result.comment,
        share: result.share,
        views: result.views,
        bookmark: result.bookmark,
      },
      media: {
        cover: result.cover,
        music: result.music,
      }
    };

    res.json({
      status: 200,
      creator: config.creator,
      data
    });
  } catch (error) {
    console.error('Error TikTok:', error.message);
    res.status(500).json({ status: 500, message: error.message || 'Terjadi kesalahan' });
  }
});

module.exports = router;
