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
 *     summary: Ambil info lagu / album / playlist dari Spotify, Apple Music, atau SoundCloud
 *     description: |
 *       Resolve URL Spotify, Apple Music, atau SoundCloud menjadi metadata
 *       (judul, artis, thumbnail, durasi). URL album / playlist mengembalikan
 *       daftar track lengkap.
 *
 *       Untuk download per track, gunakan endpoint sesuai service:
 *       `/api/music/spotify/download`, `/api/music/apple/download`, atau
 *       `/api/music/soundcloud/download`.
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
 *     summary: Download lagu Spotify menjadi MP3
 *     description: |
 *       Download lagu Spotify menjadi MP3 dari URL track
 *       (`open.spotify.com/track/...`).
 *
 *       URL album / playlist tidak diterima — gunakan `/api/music/resolve`
 *       untuk daftar URL track, lalu panggil endpoint ini per track.
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
 *     summary: Download lagu Apple Music menjadi MP3
 *     description: |
 *       Download lagu Apple Music menjadi MP3 dari URL track
 *       (`music.apple.com/.../album/...?i=<trackId>` atau
 *       `music.apple.com/.../song/...`).
 *
 *       URL album tidak diterima — gunakan `/api/music/resolve` untuk daftar
 *       URL track, lalu panggil endpoint ini per track.
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
 *     summary: Download lagu SoundCloud menjadi MP3
 *     description: |
 *       Download lagu SoundCloud menjadi MP3 dari URL track
 *       (`soundcloud.com/<user>/<track>`).
 *
 *       URL set / playlist (`/sets/...`) tidak diterima — gunakan
 *       `/api/music/resolve` untuk daftar URL track, lalu panggil endpoint
 *       ini per track.
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
