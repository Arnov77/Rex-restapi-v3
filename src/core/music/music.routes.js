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
 *       `tracks[]`. To download a single track call the matching per-service
 *       download endpoint (`/api/music/spotify/download`,
 *       `/api/music/apple/download`, or `/api/music/soundcloud/download`) with
 *       any per-track URL from the list.
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
 *     summary: Download a single Spotify track URL as MP3
 *     description: |
 *       Accepts only `open.spotify.com` URLs. Resolves artist + title via
 *       spotidown.co (Turnstile bypassed with CapSolver), then runs the
 *       YouTube MP3 pipeline (search → download → tag → 192 kbps MP3).
 *
 *       Playlist / album URLs are NOT accepted — call `/api/music/resolve`
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
 *     summary: Download a single Apple Music track URL as MP3
 *     description: |
 *       Accepts only `music.apple.com` URLs. Primary path scrapes
 *       `aaplmusicdownloader.com` (PHPSESSID session + /api/composer/swd.php
 *       + /api/composer/ffmpeg/saveid3.php) to get a server-tagged MP3, which
 *       we stream into our `/downloads/` directory.
 *
 *       Fallback path (if the upstream site is blocked / down): iTunes Search
 *       API for metadata + yt-dlp YouTube MP3 pipeline.
 *
 *       Album URLs are NOT accepted — call `/api/music/resolve` first and
 *       iterate over the per-track URLs.
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
 *     summary: Download a single SoundCloud track URL as MP3
 *     description: |
 *       Accepts only `soundcloud.com` track URLs. Primary path scrapes
 *       `scloudplaylistdownloader.app` (PHPSESSID session + POST
 *       /api/scinfo.php) which returns a signed SoundCloud CDN URL
 *       (128 kbps MP3) that we stream into our `/downloads/` directory.
 *
 *       Fallback path (if the upstream site is blocked / down): yt-dlp
 *       native SoundCloud extractor.
 *
 *       Set / playlist URLs (`/sets/...`) are NOT accepted — call
 *       `/api/music/resolve` first and iterate over the per-track URLs.
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
