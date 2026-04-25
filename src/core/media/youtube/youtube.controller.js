const youtubeService = require('./youtube.service');
const ResponseHandler = require('../../../shared/utils/response');

async function getMp3(req, res) {
  const { query } = req.validated;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const downloadData = await youtubeService.downloadMp3(query, baseUrl);
  return ResponseHandler.success(res, downloadData, 'MP3 download link generated', 200);
}

async function getMp4(req, res) {
  const { query } = req.validated;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const downloadData = await youtubeService.downloadMp4(query, baseUrl);
  return ResponseHandler.success(res, downloadData, 'MP4 download link generated', 200);
}

module.exports = { getMp3, getMp4 };
