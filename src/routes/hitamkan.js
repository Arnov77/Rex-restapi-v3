const express = require('express');
const router = express.Router();
const utils = require('../utils/utils');
const config = require('../../config');

router.get('/', async (req, res) => {
  const { image } = req.query;
  if (!image) {
    return res.status(400).json({ status: 400, message: "Parameter 'image' diperlukan" });
  }

  try {
    const url = await utils.blackenWaifuFromURL(image);
    res.json({
      status: 200,
      creator: config.creator,
      data: { imageUrl: url },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 500, message: utils.getError(err) });
  }
});

module.exports = router;
