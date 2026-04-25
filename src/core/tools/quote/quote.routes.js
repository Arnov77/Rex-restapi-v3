const express = require('express');
const router = express.Router();
const { generateQuoteImage } = require('./quote.playwright');
const ResponseHandler = require('../../../shared/utils/response');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

router.all(
  '/',
  asyncHandler(async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) {
      return ResponseHandler.error(res, 'Method Not Allowed', 405);
    }

    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.name || !obj.message) {
      return ResponseHandler.error(res, "Parameter 'name' dan 'message' wajib diisi", 400);
    }

    const buffer = await generateQuoteImage(obj.name, obj.message, obj.avatarUrl);

    res.set('Content-Type', 'image/png');
    return res.send(buffer);
  })
);

module.exports = router;
