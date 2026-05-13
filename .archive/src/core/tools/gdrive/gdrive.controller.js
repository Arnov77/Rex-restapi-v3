const gdriveService = require('./gdrive.service');
const ResponseHandler = require('../../../shared/utils/response');

async function resolve(req, res) {
  const { url } = req.validated;
  const result = await gdriveService.resolveGdriveLink(url);
  return ResponseHandler.success(res, result, 'Google Drive link fetched successfully', 200);
}

module.exports = { resolve };
