const ttsService = require('./tts.service');

async function googleTts(req, res) {
  const buffer = await ttsService.synthesize(req.validated);
  res.set('Content-Type', 'audio/ogg');
  res.set('Content-Disposition', 'inline; filename="voice-note.ogg"');
  res.set('Content-Length', String(buffer.length));
  return res.send(buffer);
}

module.exports = { googleTts };
