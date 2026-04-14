const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Utilities & Middleware
const logger = require('./src/shared/utils/logger');
const { errorHandler } = require('./src/shared/middleware/errorHandler');
const { generalLimiter, apiLimiter, aiLimiter } = require('./src/shared/middleware/rateLimiter');
const ResponseHandler = require('./src/shared/utils/response');

// Routes
const youtubeRoutes = require('./src/core/media/youtube/youtube.routes');
const bratRoutes = require('./src/core/media/brat/brat.routes');
const tiktokRoutes = require('./src/core/media/tiktok/tiktok.routes');
const instagramRoutes = require('./src/core/media/instagram/instagram.routes');
const geminiRoutes = require('./src/core/ai/gemini/gemini.routes');

// Old routes (for backwards compatibility during migration)
const bratRoute = require('./src/routes/brat');
const bratVidRoute = require('./src/routes/bratVid');
const ytplayRoute = require('./src/routes/ytplay');
const hitamRoute = require('./src/routes/hitam');
const ttdlRoute = require('./src/routes/tiktok');
const ttmp3Route = require('./src/routes/tiktok-mp3');
const igdlRoute = require('./src/routes/instagram');
const mcprofile = require('./src/routes/mcprofile');

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Create temp directory
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Create logs directory
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Create downloads directory
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
  fs.mkdirSync(downloadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));
app.use('/download', express.static(path.join(__dirname, 'downloads'))); // Alias for cleaner URLs

// Global rate limiting
app.use(generalLimiter);

// ============================================
// NEW REFACTORED ROUTES (CLEAN ARCHITECTURE)
// ============================================

// YouTube endpoints
app.use('/api/youtube', apiLimiter, youtubeRoutes);

// Brat generator endpoints
app.use('/api/brat', apiLimiter, bratRoutes);

// TikTok endpoints
app.use('/api/tiktok', apiLimiter, tiktokRoutes);

// Instagram endpoints
app.use('/api/instagram', apiLimiter, instagramRoutes);

// Gemini/AI endpoints
app.use('/api/ai/gemini', aiLimiter, geminiRoutes);

// ============================================
// OLD ROUTES (FOR BACKWARDS COMPATIBILITY)
// TO BE REMOVED AFTER MIGRATION
// ============================================
app.use('/api/bratvid', bratVidRoute);
app.use('/api/ytplay', ytplayRoute);
app.use('/api/hitam', hitamRoute);
app.use('/api/tiktok-mp3', ttmp3Route);
// app.use('/api/facebook', require('./src/routes/facebook')); // DISABLED - browser-based scraping causing crashes
app.use('/api/gdrive', require('./src/routes/gdrive'));
app.use('/api/quote', require('./src/routes/quote'));
app.use('/api/smeme', require('./src/routes/smeme'));
app.use('/api/promosi', require('./src/routes/promosi'));
app.use('/mcapi', mcprofile);

// ============================================
// UTILITY ENDPOINTS
// ============================================

/**
 * Health Check Endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * API Status Endpoint
 */
app.get('/api/status', (req, res) => {
  return ResponseHandler.success(
    res,
    {
      version: process.env.API_VERSION || '2.0.0',
      environment: process.env.NODE_ENV || 'development',
      uptime: Math.floor(process.uptime()),
    },
    'API is running',
    200
  );
});

// ============================================
// 404 HANDLER
// ============================================
app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.path}`);
  return ResponseHandler.error(
    res,
    'Endpoint not found',
    404
  );
});

// ============================================
// ERROR HANDLER (MUST BE LAST)
// ============================================
app.use(errorHandler);

// ============================================
// START SERVER
// ============================================
(async () => {
  try {
    // Initialize utils if needed
    const utils = require('./src/utils/utils');
    await utils.init();

    app.listen(PORT, () => {
      logger.success(`✅ Server running at http://localhost:${PORT}`);
      logger.success(`📚 Health check: http://localhost:${PORT}/health`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

  } catch (error) {
    logger.error(`❌ Failed to start server: ${error.message}`);
    process.exit(1);
  }
})();

module.exports = app;
