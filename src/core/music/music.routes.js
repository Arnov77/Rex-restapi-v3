const express = require('express');
const router = express.Router();
const musicController = require('./music.controller');
const validateRequest = require('../../shared/middleware/validateRequest');
const schemas = require('./music.schemas');
const { asyncHandler } = require('../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/music/resolve:
 *   get:
 *     summary: Lihat info lagu / album / playlist dari Spotify, Apple Music, atau SoundCloud
 *     description: |
 *       Tempel link Spotify, Apple Music, atau SoundCloud — endpoint ini balikin
 *       info lagunya (judul, artis, thumbnail, durasi). Kalau link-nya album atau
 *       playlist, kamu dapat list lagu sekaligus.
 *
 *       Setelah dapat info lagu, kamu bisa unduh per lagu lewat endpoint download
 *       sesuai service-nya: `/api/music/spotify/download`, `/api/music/apple/download`,
 *       atau `/api/music/soundcloud/download`.
 *     tags: [Media]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *           example: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
 *     responses:
 *       200: { description: Resolved track / album / playlist metadata }
 *       400: { description: Unsupported URL host or invalid URL }
 *       502: { description: Upstream resolver failed }
 *       503: { description: Spotify resolver requires CAPSOLVER_API_KEY }
 *       504: { description: Upstream resolver timed out }
 */
router.get(
  '/resolve',
  validateRequest(schemas.resolveSchema, 'query'),
  asyncHandler(musicController.resolve)
);

/**
 * @openapi
 * /api/music/spotify/download:
 *   get:
 *     summary: Unduh lagu Spotify jadi MP3
 *     description: |
 *       Tempel link track Spotify, dapatkan link unduhan MP3. Hanya menerima link
 *       lagu (`open.spotify.com/track/...`).
 *
 *       Untuk album / playlist, panggil `/api/music/resolve` dulu untuk lihat
 *       daftar lagu, lalu unduh per lagu satu per satu.
 *     tags: [Media]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *           example: https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT
 *     responses:
 *       200: { description: Track resolved and MP3 download link generated }
 *       400: { description: URL is not a Spotify track URL, or bulk URL submitted }
 *       502: { description: Spotify resolver or YouTube download failed }
 *       503: { description: Spotify resolver requires CAPSOLVER_API_KEY }
 */
router.get(
  '/spotify/download',
  validateRequest(schemas.downloadSchema, 'query'),
  asyncHandler(musicController.downloadSpotify)
);

/**
 * @openapi
 * /api/music/apple/download:
 *   get:
 *     summary: Unduh lagu Apple Music jadi MP3
 *     description: |
 *       Tempel link track Apple Music, dapatkan link unduhan MP3. Hanya menerima
 *       link lagu (`music.apple.com/.../album/...?i=<trackId>` atau
 *       `music.apple.com/.../song/...`).
 *
 *       Untuk album, panggil `/api/music/resolve` dulu untuk lihat daftar lagu,
 *       lalu unduh per lagu satu per satu.
 *     tags: [Media]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *           example: https://music.apple.com/us/album/cruel-summer/1468058165?i=1468058171
 *     responses:
 *       200: { description: Track resolved and MP3 download link generated }
 *       400: { description: URL is not an Apple Music track URL, or bulk URL submitted }
 *       502: { description: Apple Music resolver or YouTube download failed }
 */
router.get(
  '/apple/download',
  validateRequest(schemas.downloadSchema, 'query'),
  asyncHandler(musicController.downloadApple)
);

/**
 * @openapi
 * /api/music/soundcloud/download:
 *   get:
 *     summary: Unduh lagu SoundCloud jadi MP3
 *     description: |
 *       Tempel link track SoundCloud, dapatkan link unduhan MP3. Hanya menerima
 *       link lagu (`soundcloud.com/<user>/<track>`).
 *
 *       Untuk playlist / set (`/sets/...`), panggil `/api/music/resolve` dulu
 *       untuk lihat daftar lagu, lalu unduh per lagu satu per satu.
 *     tags: [Media]
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *           format: uri
 *           example: https://soundcloud.com/forss/flickermood
 *     responses:
 *       200: { description: Track downloaded and MP3 link generated }
 *       400: { description: URL is not a SoundCloud track URL, or set URL submitted }
 *       502: { description: SoundCloud download failed }
 */
router.get(
  '/soundcloud/download',
  validateRequest(schemas.downloadSchema, 'query'),
  asyncHandler(musicController.downloadSoundcloud)
);

module.exports = router;
