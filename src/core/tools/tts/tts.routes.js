const express = require('express');
const router = express.Router();
const ttsController = require('./tts.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const { googleTtsSchema } = require('./tts.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/tts/google:
 *   post:
 *     summary: Synthesize text to a WhatsApp-ready voice note (ogg/opus)
 *     description: |
 *       Uses the public Google Translate TTS endpoint via google-tts-api
 *       (no API key required) and transcodes the mp3 stream to ogg/opus
 *       (libopus, 16 kHz mono, 32 kbps, voip profile) — the format
 *       WhatsApp recognises as a voice note (PTT) when forwarded.
 *
 *       Long text is chunked automatically (~200 chars per Google call) and
 *       concatenated before transcoding.
 *     tags: [Tools]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [text]
 *             properties:
 *               text:
 *                 type: string
 *                 maxLength: 5000
 *                 example: Halo, ini contoh voice note dari REX API.
 *               lang:
 *                 type: string
 *                 default: id
 *                 example: id
 *                 description: BCP-47 / ISO-639 language code (id, en, en-US, ja, ...)
 *               slow:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: ogg/opus audio bytes
 *         content:
 *           audio/ogg: {}
 *       400: { description: Validation failed }
 *       502: { description: Upstream Google TTS error }
 */
router.post('/google', validateRequest(googleTtsSchema), asyncHandler(ttsController.googleTts));

module.exports = router;
