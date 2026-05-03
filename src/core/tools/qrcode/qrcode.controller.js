const qrcodeService = require('./qrcode.service');

async function generate(req, res) {
  const { buffer, mimeType, format } = await qrcodeService.generate(req.validated);
  const ext = format;
  res.set('Content-Type', mimeType);
  res.set('Content-Disposition', `inline; filename="qrcode.${ext}"`);
  res.set('Content-Length', String(buffer.length));
  return res.send(buffer);
}

module.exports = { generate };
