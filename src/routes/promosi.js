const express = require('express');
const router = express.Router();
const utils = require('../utils/utils');
const config = require('../../config');

router.all('/', async (req, res) => {
    if (!['GET', 'POST'].includes(req.method)) {
        return res.status(405).json({ status: 405, message: 'Method Not Allowed' });
    }
    
    const obj = req.method === 'GET' ? req.query : req.body;
    if (!obj.text) {
        return res.status(400).json({ status: 400, message: "Parameter 'text' diperlukan" });
    }

    const threshold = parseInt(obj.threshold) || 70;
    
    try {
        const { percentage, reason } = await utils.promotionDetector(obj.text);
        const isPromotion = percentage >= threshold;
        
        res.json({
          status: 200,
          creator: config.creator,
          result: {
            percentage,
            isPromotion,
            reason
          }
        });        
    } catch (e) {
        console.error(e);
        res.status(500).json({ status: 500, message: utils.getError(e) });
    }
});

module.exports = router;