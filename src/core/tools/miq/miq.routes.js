const express = require('express');
const multer = require('multer');
const router = express.Router();
const miqController = require('./miq.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const miqSchemas = require('../../../shared/validators/miqSchemas');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
  },
});

/**
 * POST /api/miq/generate
 * Generate quote image
 */
router.post(
  '/generate',
  upload.single('avatar'),
  validateRequest(miqSchemas.generateQuote),
  miqController.generateQuote.bind(miqController)
);

module.exports = router;
