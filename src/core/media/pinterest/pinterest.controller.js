const pinterestService = require('./pinterest.service');
const ResponseHandler = require('../../../shared/utils/response');

async function download(req, res) {
  const { url } = req.validated;
  const data = await pinterestService.download(url);
  return ResponseHandler.success(res, data, 'Pinterest pin fetched successfully', 200);
}

module.exports = { download };
