const twitterService = require('./twitter.service');
const ResponseHandler = require('../../../shared/utils/response');

async function download(req, res) {
  const { url } = req.validated;
  const data = await twitterService.download(url);
  return ResponseHandler.success(res, data, 'Twitter content fetched successfully', 200);
}

module.exports = { download };
