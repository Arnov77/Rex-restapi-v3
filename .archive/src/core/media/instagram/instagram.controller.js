const instagramService = require('./instagram.service');
const ResponseHandler = require('../../../shared/utils/response');

async function download(req, res) {
  const { url } = req.validated;
  const data = await instagramService.download(url);
  return ResponseHandler.success(res, data, 'Instagram content fetched successfully', 200);
}

module.exports = { download };
