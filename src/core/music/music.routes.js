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
 *     summary: Resolve a Spotify, Apple Music, or SoundCloud URL to track metadata
 *     description: |
 *       Inspects the URL host and dispatches to the correct upstream:
 *       - **open.spotify.com** → spotidown.co (Cloudflare Turnstile bypassed via CapSolver — requires `CAPSOLVER_API_KEY`).
 *       - **music.apple.com** → iTunes Search API (free, no auth). Albums and individual tracks supported. Apple Music user-curated playlists are NOT supported.
 *       - **soundcloud.com** → yt-dlp metadata extractor (single tracks + sets).
 *
 *       For tracks the response is a flat `{ type: "track", track: {...} }`. For
 *       playlists / albums a list of normalised tracks is returned under
 *       `tracks[]`. To download a single track call `/api/music/download` with
 *       the same URL (or any per-track URL from the list).
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
 * /api/music/download:
 *   get:
 *     summary: Download a single track URL as MP3 (server-hosted file)
 *     description: |
 *       Resolves the supplied URL to artist + title, then runs the YouTube
 *       MP3 pipeline (search → download → tag → 192kbps MP3). For SoundCloud
 *       track URLs we use yt-dlp directly against SoundCloud (no YouTube
 *       round-trip). Returns a public `download` URL served from `/downloads/`.
 *
 *       Bulk URLs (album / playlist) are NOT accepted — call `/api/music/resolve`
 *       first and iterate over the per-track URLs.
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
 *       400: { description: Unsupported URL host, invalid URL, or bulk URL submitted }
 *       502: { description: Resolver or YouTube download failed }
 *       503: { description: Spotify resolver requires CAPSOLVER_API_KEY }
 */
router.get(
  '/download',
  validateRequest(schemas.downloadSchema, 'query'),
  asyncHandler(musicController.download)
);

module.exports = router;
