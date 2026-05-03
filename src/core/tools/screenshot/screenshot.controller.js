const screenshotService = require('./screenshot.service');

async function capture(req, res) {
  const { buffer, mimeType, format } = await screenshotService.capture(req.validated);
  const ext = format === 'jpeg' ? 'jpg' : format;
  res.set('Content-Type', mimeType);
  res.set('Content-Disposition', `inline; filename="screenshot.${ext}"`);
  res.set('Content-Length', String(buffer.length));
  return res.send(buffer);
}

module.exports = { capture };
