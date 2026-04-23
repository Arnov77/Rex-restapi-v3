const express = require('express');
const router = express.Router();
const utils = require('../../../utils/utils');
const ResponseHandler = require('../../../shared/utils/response');

router.all('/', async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) {
    return ResponseHandler.error(res, 'Method Not Allowed', 405);
  }

  try {
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.name || !obj.message) {
      return ResponseHandler.error(res, "Parameter 'name' dan 'message' wajib diisi", 400);
    }

    const buffer = await utils.generateQuoteImage(obj.name, obj.message, obj.avatarUrl);

    // Kembalikan gambar langsung
    res.set('Content-Type', 'image/png');
    res.send(buffer);
    
  } catch (e) {
    console.error(e);
    return ResponseHandler.error(res, utils.getError(e), 500);
  }
});

module.exports = router;
