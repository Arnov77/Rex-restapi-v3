const tiktokService = require('./tiktok.service');
const ResponseHandler = require('../../../shared/utils/response');

async function downloadVideo(req, res) {
  const { url } = req.validated;
  const data = await tiktokService.downloadVideo(url);
  return ResponseHandler.success(res, data, 'TikTok video data fetched successfully', 200);
}

async function downloadAudio(req, res) {
  const { url } = req.validated;
  const data = await tiktokService.downloadAudio(url);
  return ResponseHandler.success(res, data, 'TikTok audio data fetched successfully', 200);
}

module.exports = { downloadVideo, downloadAudio };
