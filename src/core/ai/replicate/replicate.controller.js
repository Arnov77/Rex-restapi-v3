const replicateService = require('./replicate.service');

async function generateImage(req, res) {
  const { image, option } = req.validated;
  const buffer = await replicateService.generateModifiedImage(image, option);
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', 'inline; filename="generated.png"');
  return res.send(buffer);
}

module.exports = { generateImage };
