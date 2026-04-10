const logger = require('../utils/logger');
const ResponseHandler = require('../utils/response');
const { AppError } = require('../utils/errors');

/**
 * Global Error Handler Middleware
 * MUST be placed at the end of all routes and middleware
 */
const errorHandler = (err, req, res, next) => {
  const isDevelopment = process.env.NODE_ENV === 'development';

  // Log the error
  logger.error(`[${req.method}] ${req.path} - ${err.message}`);
  if (isDevelopment) {
    logger.debug(err.stack);
  }

  // Determine status code
  const statusCode = err.statusCode || 500;
  
  // Determine message
  let message = err.message;
  if (!isDevelopment && statusCode === 500) {
    message = 'Internal Server Error';
  }

  // Send error response
  return ResponseHandler.error(res, message, statusCode);
};

/**
 * Async route handler wrapper
 * Catches errors in async handlers and passes to error middleware
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = { errorHandler, asyncHandler, AppError };
