const multer = require('multer');
const logger = require('../utils/logger');
const ResponseHandler = require('../utils/response');
const { AppError } = require('../utils/errors');

// Normalises the wide variety of errors thrown by upstream libraries (multer,
// body-parser, axios, node-fetch) into a consistent shape: `{ statusCode,
// message }`. Unknown errors fall back to 500.
function normalize(err) {
  if (err instanceof AppError) {
    return { statusCode: err.statusCode, message: err.message };
  }

  if (err instanceof multer.MulterError) {
    const statusCode = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return { statusCode, message: `Upload error: ${err.message}` };
  }

  // express.json()/urlencoded() throws SyntaxError with `.status = 400` and a
  // `.type = 'entity.parse.failed'` for malformed bodies, or status 413 for
  // payloads larger than the configured limit.
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return { statusCode: 400, message: 'Invalid JSON payload' };
  }
  if (err.type === 'entity.too.large') {
    return { statusCode: 413, message: 'Request payload too large' };
  }

  // axios upstream errors — surface upstream status as a 5xx without leaking
  // the full response body (which can contain upstream secrets / internals).
  if (err.isAxiosError) {
    const upstreamStatus = err.response?.status;
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500) {
      return { statusCode: 502, message: `Upstream rejected request (${upstreamStatus})` };
    }
    return { statusCode: 502, message: 'Upstream service error' };
  }

  const statusCode = err.statusCode || err.status || 500;
  return { statusCode, message: err.message || 'Internal Server Error' };
}

const errorHandler = (err, req, res, _next) => {
  const { statusCode, message } = normalize(err);
  const isDevelopment = process.env.NODE_ENV === 'development';

  const reqId = req.id ? `[${req.id}] ` : '';
  logger.error(`${reqId}[${req.method}] ${req.path} → ${statusCode} ${message}`);
  if (statusCode >= 500) {
    // Always emit the stack for 5xx so production incidents are diagnosable;
    // for 4xx the message is usually enough and the stack just adds noise.
    logger.error(err.stack || String(err));
  }

  const clientMessage = !isDevelopment && statusCode === 500 ? 'Internal Server Error' : message;
  return ResponseHandler.error(res, clientMessage, statusCode);
};

// Async route handler wrapper — forwards rejected promises to the error
// handler so controllers can stop writing try/catch boilerplate.
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = { errorHandler, asyncHandler, AppError };
