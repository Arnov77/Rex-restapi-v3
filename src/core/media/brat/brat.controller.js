const bratService = require('./brat.service');

async function generateImage(req, res) {
  const buffer = await bratService.generateImage(req.validated);
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', 'inline; filename="brat.png"');
  return res.send(buffer);
}

async function generateVideo(req, res) {
  const gif = await bratService.generateVideo(req.validated);
  res.set('Content-Type', 'image/gif');
  res.set('Content-Disposition', 'inline; filename="brat.gif"');
  return res.send(gif);
}

module.exports = { generateImage, generateVideo };
