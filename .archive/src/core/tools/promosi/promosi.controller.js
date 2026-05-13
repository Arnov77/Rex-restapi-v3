const { promotionDetector } = require('./promosi.service');
const ResponseHandler = require('../../../shared/utils/response');

async function analyze(req, res) {
  const { text, threshold } = req.validated;
  const { percentage, reason } = await promotionDetector(text);
  const isPromotion = percentage >= threshold;
  return ResponseHandler.success(
    res,
    { percentage, isPromotion, reason },
    'Promotion analysis completed',
    200
  );
}

module.exports = { analyze };
