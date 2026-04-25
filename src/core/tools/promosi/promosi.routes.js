const express = require('express');
const router = express.Router();
const { promotionDetector } = require('./promosi.service');
const ResponseHandler = require('../../../shared/utils/response');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

router.all(
  '/',
  asyncHandler(async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) {
      return ResponseHandler.error(res, 'Method Not Allowed', 405);
    }

    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.text) {
      return ResponseHandler.error(res, "Parameter 'text' diperlukan", 400);
    }

    const threshold = parseInt(obj.threshold, 10) || 70;

    const { percentage, reason } = await promotionDetector(obj.text);
    const isPromotion = percentage >= threshold;

    return ResponseHandler.success(
      res,
      { percentage, isPromotion, reason },
      'Promotion analysis completed',
      200
    );
  })
);

module.exports = router;
