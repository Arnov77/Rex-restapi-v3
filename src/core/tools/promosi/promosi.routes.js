const express = require('express');
const router = express.Router();
const utils = require('../../../utils/utils');
const ResponseHandler = require('../../../shared/utils/response');

router.all('/', async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) {
        return ResponseHandler.error(res, 'Method Not Allowed', 405);
    }
    
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.text) {
        return ResponseHandler.error(res, "Parameter 'text' diperlukan", 400);
    }

    const threshold = parseInt(obj.threshold) || 70;
    
    try {
        const { percentage, reason } = await utils.promotionDetector(obj.text);
        const isPromotion = percentage >= threshold;
        
        return ResponseHandler.success(
          res,
          {
            percentage,
            isPromotion,
            reason,
          },
          'Promotion analysis completed',
          200
        );
    } catch (e) {
        console.error(e);
        return ResponseHandler.error(res, utils.getError(e), 500);
    }
});

module.exports = router;
