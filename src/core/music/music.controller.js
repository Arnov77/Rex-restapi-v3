const musicService = require('./music.service');
const ResponseHandler = require('../../shared/utils/response');

async function resolve(req, res) {
  const url = req.validated?.url || req.query.url || req.body?.url;
  const data = await musicService.resolve(url);
  return ResponseHandler.success(res, data, 'Music URL resolved', 200);
}

async function download(req, res) {
  const url = req.validated?.url || req.query.url || req.body?.url;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const data = await musicService.download(url, baseUrl);
  return ResponseHandler.success(res, data, 'MP3 download link generated', 200);
}

module.exports = { resolve, download };
