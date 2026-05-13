const screenshotService = require('./screenshot.service');
const { assertPublicUrl } = require('../../../shared/utils/ssrfGuard');

async function capture(req, res) {
  // SSRF guard — refuse loopback, private, link-local, and cloud-metadata
  // targets before handing the URL to a headless browser.
  await assertPublicUrl(req.validated.url);

  const { buffer, mimeType, format } = await screenshotService.capture(req.validated);
  const ext = format === 'jpeg' ? 'jpg' : format;
  res.set('Content-Type', mimeType);
  res.set('Content-Disposition', `inline; filename="screenshot.${ext}"`);
  res.set('Content-Length', String(buffer.length));
  return res.send(buffer);
}

module.exports = { capture };
