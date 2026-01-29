const express = require('express');
const router = express.Router();
const utils = require('../utils/utils');
const config = require('../../config');

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  const obj = req.method === 'GET' ? req.query : req.body;
  if (!obj.url) {
    return res.status(400).json({ status: 400, message: "Parameter 'url' diperlukan" });
  }

  try {
    const data = await utils.facebookDownloader(obj.url);

    res.json({
      status: 200,
      creator: config.creator,
      data
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 500, message: utils.getError(e) });
  }
});

module.exports = router;
