const express = require('express');
const router = express.Router();
const multer = require('multer');
const axios = require('axios');
const utils = require('../utils/utils');
const config = require('../../config');

const upload = multer();

// POST: kirim file langsung
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 400, message: "Parameter 'image' (file upload) diperlukan" });
    }

    const resultUrl = await utils.generateHitamkanWaifu(req.file.buffer);

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

// GET: ambil gambar dari URL
router.get('/', async (req, res) => {
  try {
    const imageUrl = req.query.image;
    if (!imageUrl) {
      return res.status(400).json({ status: 400, message: "Parameter 'image' (URL) diperlukan" });
    }

    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');

    const resultUrl = await utils.generateHitamkanWaifu(imageBuffer);

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
