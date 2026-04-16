const express = require('express');
const router = express.Router();
const miqController = require('./miq.controller');
const validateRequest = require('../../../shared/middleware/validateRequest');
const miqSchemas = require('../../../shared/validators/miqSchemas');

/**
 * POST /api/miq/generate
 * Generate quote image
 */
router.post('/generate', validateRequest(miqSchemas.generateQuote), miqController.generateQuote.bind(miqController));

/**
 * POST /api/miq/generate-beta
 * Generate quote image using beta API
 */
router.post('/generate-beta', validateRequest(miqSchemas.generateQuote), miqController.generateQuoteBeta.bind(miqController));

module.exports = router;
