const smemeService = require('./smeme.service');

async function generate(req, res) {
  const { buffer, contentType } = await smemeService.generateMeme(req.validated);
  res.set('Content-Type', contentType);
  return res.send(buffer);
}

module.exports = { generate };
