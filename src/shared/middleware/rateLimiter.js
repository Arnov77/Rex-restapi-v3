const rateLimit = require('express-rate-limit');
const ResponseHandler = require('../utils/response');

// Shared handler — keeps every rate-limited response on the same envelope as
// the rest of the API (success/statusCode/message/data/timestamp).
const buildHandler = (message) => (req, res) => ResponseHandler.error(res, message, 429);

// Applied to every request as a broad abuse safeguard.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || req.path === '/api/status',
  handler: buildHandler('Too many requests from this IP, please slow down.'),
});

// Default tier for regular /api/* endpoints (text/JSON work).
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many requests to this endpoint, please slow down.'),
});

// Heavier tier for endpoints that spin up a browser, scrape an upstream, or
// transcode media — these are slow and expensive, so the ceiling is lower.
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('Too many heavy requests, please slow down.'),
});

// Reserved for AI-backed endpoints (Gemini / Replicate). Hourly budget to keep
// upstream costs predictable. Currently unused — Gemini route is not mounted
// yet — but exported so it's ready when PR-5 wires it in.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: buildHandler('AI endpoint hourly quota reached, try again later.'),
});

module.exports = {
  generalLimiter,
  apiLimiter,
  heavyLimiter,
  aiLimiter,
};
