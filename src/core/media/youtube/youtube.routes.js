const express = require('express');
const router = express.Router();
const youtubeController = require('./youtube.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const schemas = require('./youtube.schemas');
const { asyncHandler } = require('../../../shared/middleware/errorHandler');

/**
 * @openapi
 * /api/youtube/mp3:
 *   get:
 *     summary: Search YouTube and return MP3 download URLs
 *     tags: [Media]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema: { type: string, minLength: 1, maxLength: 200 }
 *     responses:
 *       200: { description: Audio download options }
 *   post:
 *     summary: Same as GET, but via JSON body
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query]
 *             properties:
 *               query: { type: string }
 */
router
  .route('/mp3')
  .get(validateRequest(schemas.downloadMp3Schema, 'query'), asyncHandler(youtubeController.getMp3))
  .post(validateRequest(schemas.downloadMp3Schema, 'body'), asyncHandler(youtubeController.getMp3));

/**
 * @openapi
 * /api/youtube/mp4:
 *   get:
 *     summary: Search YouTube and return MP4 download URLs
 *     tags: [Media]
 *     parameters:
 *       - in: query
 *         name: query
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Video download options }
 *   post:
 *     summary: Same as GET, but via JSON body
 *     tags: [Media]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [query]
 *             properties:
 *               query: { type: string }
 */
router
  .route('/mp4')
  .get(validateRequest(schemas.downloadMp4Schema, 'query'), asyncHandler(youtubeController.getMp4))
  .post(validateRequest(schemas.downloadMp4Schema, 'body'), asyncHandler(youtubeController.getMp4));

module.exports = router;
