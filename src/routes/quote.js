const express = require('express');
const router = express.Router();
const utils = require('../utils/utils');
const config = require('../../config');

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.name || !obj.message) {
      return res.status(400).json({ status: 400, message: "Parameter 'name' dan 'message' wajib diisi" });
    }

    const buffer = await utils.generateQuoteImage(obj.name, obj.message, obj.avatarUrl);

    // Kembalikan gambar langsung
    res.set('Content-Type', 'image/png');
    res.send(buffer);
    
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 500, message: utils.getError(e) });
  }
});

module.exports = router;
