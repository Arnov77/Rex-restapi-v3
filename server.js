const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const logger = require('./src/shared/utils/logger');
const { errorHandler } = require('./src/shared/middleware/errorHandler');
const { generalLimiter, apiLimiter, aiLimiter } = require('./src/shared/middleware/rateLimiter');
const ResponseHandler = require('./src/shared/utils/response');

const youtubeRoutes = require('./src/core/media/youtube/youtube.routes');
const bratRoutes = require('./src/core/media/brat/brat.routes');
const tiktokRoutes = require('./src/core/media/tiktok/tiktok.routes');
const instagramRoutes = require('./src/core/media/instagram/instagram.routes');

const gdriveRoute = require('./src/core/tools/gdrive/gdrive.routes');
const quoteRoute = require('./src/core/tools/quote/quote.routes');
const smemeRoute = require('./src/core/tools/smeme/smeme.routes');
const promosiRoute = require('./src/core/tools/promosi/promosi.routes');
const mcprofileRoute = require('./src/core/tools/mcprofile/mcprofile.routes');
const miqRoute = require('./src/core/tools/miq/miq.routes');

const app = express();
const PORT = process.env.PORT || 3000;

function ensureDir(dirname) {
  const target = path.join(__dirname, dirname);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
}

['temp', 'logs', 'downloads'].forEach(ensureDir);

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/downloads', express.static(path.join(__dirname, 'downloads')));
app.use('/download', express.static(path.join(__dirname, 'downloads')));

app.use(generalLimiter);

app.use('/api/youtube', apiLimiter, youtubeRoutes);
app.use('/api/brat', apiLimiter, bratRoutes);
app.use('/api/tiktok', apiLimiter, tiktokRoutes);
app.use('/api/instagram', apiLimiter, instagramRoutes);
app.use('/api/gdrive', apiLimiter, gdriveRoute);
app.use('/api/quote', apiLimiter, quoteRoute);
app.use('/api/smeme', apiLimiter, smemeRoute);
app.use('/api/promosi', apiLimiter, promosiRoute);
app.use('/api/miq', apiLimiter, miqRoute);
app.use('/mcapi', apiLimiter, mcprofileRoute);

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

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

app.use((req, res) => {
  logger.warn(`404 Not Found: ${req.method} ${req.path}`);
  return ResponseHandler.error(res, 'Endpoint not found', 404);
});

app.use(errorHandler);

async function startServer() {
  try {
    const utils = require('./src/utils/utils');
    await utils.init();

    app.listen(PORT, () => {
      logger.success(`Server running at http://localhost:${PORT}`);
      logger.info(`Health check: http://localhost:${PORT}/health`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exit(1);
  }
}

startServer();

module.exports = app;
