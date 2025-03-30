const express = require('express');
const router = express.Router();
const utils = require('../utils/utils');
const config = require('../../config'); // Import config.js

// Endpoint untuk generate Brat Video
router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.text) {
      return res.status(400).json({ status: 400, message: "Parameter 'text' diperlukan" });
    }

    const fileUrl = await utils.generateBratVideo(obj.text);

    res.json({
      status: 200,
      creator: config.creator,
      data: {
        gifUrl: fileUrl,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 500, message: utils.getError(e) });
  }
});

module.exports = router;
