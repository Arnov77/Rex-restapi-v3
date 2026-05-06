const musicService = require('./music.service');
const ResponseHandler = require('../../shared/utils/response');

async function resolve(req, res) {
  const url = req.validated?.url || req.query.url || req.body?.url;
  const data = await musicService.resolve(url);
  return ResponseHandler.success(res, data, 'Music URL resolved', 200);
}

function _baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

async function downloadSpotify(req, res) {
  const url = req.validated?.url || req.query.url || req.body?.url;
  const data = await musicService.downloadSpotify(url, _baseUrl(req));
  return ResponseHandler.success(res, data, 'Spotify MP3 download link generated', 200);
}

async function downloadApple(req, res) {
  const url = req.validated?.url || req.query.url || req.body?.url;
  const data = await musicService.downloadApple(url, _baseUrl(req));
  return ResponseHandler.success(res, data, 'Apple Music MP3 download link generated', 200);
}

async function downloadSoundcloud(req, res) {
  const url = req.validated?.url || req.query.url || req.body?.url;
  const data = await musicService.downloadSoundcloud(url, _baseUrl(req));
  return ResponseHandler.success(res, data, 'SoundCloud MP3 download link generated', 200);
}

module.exports = { resolve, downloadSpotify, downloadApple, downloadSoundcloud };
