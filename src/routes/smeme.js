const express = require('express');
const router = express.Router();
const utils = require('../utils/utils');
const config = require('../../config');

// Endpoint: /meme
router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;

    const { image, top, bottom } = obj;
    if (!image) return res.status(400).json({ status: 400, message: "Parameter 'image' diperlukan (URL gambar)" });

    const resultUrl = await utils.generateMemeImage(image, top || '', bottom || '');

    res.json({
      status: 200,
      creator: config.creator,
      data: {
        imageUrl: resultUrl,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 500, message: utils.getError(e) });
  }
});

module.exports = router;
