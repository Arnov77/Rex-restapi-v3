const quoteService = require('./quote.service');

async function generate(req, res) {
  const buffer = await quoteService.generateQuote(req.validated);
  res.set('Content-Type', 'image/png');
  res.set('Content-Disposition', 'inline; filename="quote.png"');
  return res.send(buffer);
}

module.exports = { generate };
