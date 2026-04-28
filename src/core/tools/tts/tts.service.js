const { Readable, PassThrough } = require('node:stream');
const googleTts = require('google-tts-api');
const ffmpeg = require('fluent-ffmpeg');
const logger = require('../../../shared/utils/logger');
const { AppError } = require('../../../shared/utils/errors');

/**
 * google-tts-api emits chunks of base64-encoded mp3 (one per ~200 chars).
 * We decode each chunk to a Buffer and concat them — the resulting binary
 * is a valid mp3 (the API normalises framing across chunks). This is safe
 * to feed straight into ffmpeg as `-i pipe:0`.
 */
async function fetchMp3Buffer(text, lang, slow) {
  const chunks = await googleTts.getAllAudioBase64(text, {
    lang,
    slow,
    host: 'https://translate.google.com',
    timeout: 10_000,
    splitPunct: ',.?!',
  });

  if (!chunks || chunks.length === 0) {
    throw new AppError('Google TTS returned no audio chunks', 502);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c.base64, 'base64')));
}

/**
 * Transcode mp3 → ogg/opus tuned for WhatsApp Voice Note playback:
 *   - libopus codec, single mono channel
 *   - 16 kHz sample rate (PTT spec)
 *   - 32 kbps target bitrate (recognised as voice-note bitrate by WhatsApp)
 *   - voip application profile for tighter envelope at low bitrate
 *
 * Streams in / out of ffmpeg via stdin / stdout so we never touch disk.
 */
function transcodeToOpusOgg(mp3Buffer) {
  return new Promise((resolve, reject) => {
    const out = new PassThrough();
    const buffers = [];
    out.on('data', (b) => buffers.push(b));
    out.on('end', () => resolve(Buffer.concat(buffers)));
    out.on('error', reject);

    const input = Readable.from(mp3Buffer);

    ffmpeg(input)
      .inputFormat('mp3')
      .audioCodec('libopus')
      .audioChannels(1)
      .audioFrequency(16000)
      .audioBitrate('32k')
      .outputOptions(['-application voip', '-vbr on', '-compression_level 10'])
      .format('ogg')
      .on('error', (err) => reject(new AppError(`ffmpeg failed: ${err.message}`, 500)))
      .pipe(out, { end: true });
  });
}

/**
 * Synthesize text to a WhatsApp-ready ogg/opus voice-note buffer.
 *
 * Two-step pipeline:
 *   1. google-tts-api → mp3 buffer (handles long-text splitting)
 *   2. ffmpeg          → ogg/opus 16kHz mono 32kbps (WhatsApp PTT spec)
 *
 * Returns the final ogg buffer; controller is responsible for setting the
 * Content-Type / Content-Disposition headers.
 */
async function synthesize({ text, lang = 'id', slow = false }) {
  const previewText = text.length > 60 ? `${text.slice(0, 57)}...` : text;
  logger.info(`[TTS] Synthesising ${text.length} chars (lang=${lang}): "${previewText}"`);

  const mp3 = await fetchMp3Buffer(text, lang, slow);
  logger.info(`[TTS] Fetched mp3 buffer (${mp3.length} bytes)`);

  const ogg = await transcodeToOpusOgg(mp3);
  logger.success(`[TTS] Transcoded to ogg/opus (${ogg.length} bytes)`);

  return ogg;
}

module.exports = {
  synthesize,
  _internal: { fetchMp3Buffer, transcodeToOpusOgg },
};
