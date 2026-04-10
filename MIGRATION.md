# Architecture Refactor - Migration Guide

## 📋 Overview

This document explains the refactored architecture and how to migrate from the old structure to the new clean architecture.

---

## 🏗️ New Project Structure

```
src/
├── config/                 (Configuration files)
├── core/                   (Domain services)
│   ├── media/
│   │   ├── brat/          (Image/Video generation)
│   │   ├── youtube/       (YouTube downloads)
│   │   ├── tiktok/        (TikTok downloads)
│   │   └── instagram/     (Instagram downloads)
│   └── ai/
│       └── gemini/        (AI image generation)
├── infrastructure/        (External integrations)
├── shared/               (Cross-cutting concerns)
│   ├── middleware/       (Request middleware)
│   ├── utils/            (Utilities & helpers)
│   └── validators/       (Input validation schemas)
├── utils/                (Legacy - to be removed)
├── routes/               (Legacy - to be removed)
└── controllers/          (Legacy - to be removed)
```

---

## 🔄 Layered Architecture Explanation

### **Layer 1: Routes** (`*.routes.js`)
- Handles HTTP routing only
- Delegates to controllers
- Validates request via middleware

### **Layer 2: Controllers** (`*.controller.js`)
- Handles HTTP request/response
- Calls services
- Returns standardized responses

### **Layer 3: Services** (`*.service.js`)
- Contains business logic
- Calls external APIs
- Returns domain objects

### **Layer 4: Infrastructure**
- External service clients (APIs, databases, storage)
- Isolated from business logic

---

## 🔌 Key Changes

### ✅ Before (Mixed Concerns)
```javascript
router.all('/', async (req, res) => {
  // HTTP handling
  // Validation
  // Business logic
  // Response formatting
  // Error handling
  // All in ONE function!
});
```

### ✅ After (Separation of Concerns)
```javascript
// Route: Just routing
router.post('/download', validateRequest(schema), asyncHandler(controller.download));

// Controller: HTTP handling
async download(req, res, next) {
  const data = await service.download(req.validated);
  return ResponseHandler.success(res, data);
}

// Service: Business logic
async download(url) {
  const result = await externalApi.fetch(url);
  return this._format(result);
}
```

---

## 📚 API Examples

### YouTube MP3 Download
**Old Endpoint:** `POST /api/ytmp3` → Returns formatted data
**New Endpoint:** `POST /api/youtube/mp3`

```bash
curl -X POST http://localhost:3000/api/youtube/mp3 \
  -H "Content-Type: application/json" \
  -d '{"query": "Never Gonna Give You Up"}'
```

**Response:**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "MP3 download data fetched successfully",
  "data": {
    "title": "Never Gonna Give You Up",
    "duration": "3:32",
    "formats": [
      { "quality": "256kbps", "downloadUrl": "...", "format": "audio/mpeg" },
      { "quality": "192kbps", "downloadUrl": "...", "format": "audio/mpeg" }
    ]
  },
  "timestamp": "2026-04-09T10:30:00.000Z"
}
```

### Brat Image Generation
**Old:** `GET/POST /api/brat?text=Hello`
**New:** `POST /api/brat/image`

```bash
curl -X POST http://localhost:3000/api/brat/image \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello World",
    "preset": "bratdeluxe",
    "bgColor": "#000000",
    "textColor": "#FFFFFF"
  }'
```

Returns: PNG image directly (binary)

---

## 🛡️ Validation

All endpoints now use **Joi schemas** for validation:

```javascript
// Example validation
{
  query: Joi.string().min(1).max(200).required(),
  preset: Joi.string().valid('brat', 'bratdeluxe', 'custom').default('bratdeluxe')
}
```

Validation errors return:
```json
{
  "success": false,
  "statusCode": 400,
  "message": "query cannot be empty (max 200 chars)",
  "timestamp": "2026-04-09T10:30:00.000Z"
}
```

---

## ⚠️ Error Handling

**Centralized Error Handler** catches all errors:

```javascript
// Custom error types
throw new ValidationError("Invalid input");       // 400
throw new NotFoundError("Video not found");       // 404
throw new UnauthorizedError("No API key");        // 401
throw new AppError("Something failed", 500);      // 500
```

All errors return consistent format:
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Validation error message",
  "timestamp": "2026-04-09T10:30:00.000Z"
}
```

---

## 📊 Logging

Logs are written to:
- **Console** (colored output)
- **logs/info.log** (info level)
- **logs/error.log** (error level)
- **logs/combined.log** (all logs)

```javascript
logger.info("Starting download...");
logger.success("Download completed!");
logger.error("Download failed");
logger.warn("Warning message");
logger.debug("Debug detail"); // Only in development
```

---

## 🔐 Rate Limiting

Three tiers of rate limiting:

1. **General Limiter** (applied globally)
   - 100 requests per 15 minutes

2. **API Limiter** (for media endpoints)
   - 30 requests per 1 minute

3. **AI Limiter** (for AI operations)
   - 10 requests per 5 minutes

---

## 🚀 Running the Application

### Development
```bash
npm run dev
```
Uses `nodemon` for auto-reload

### Production
```bash
npm start
```

### View Logs
```bash
npm run logs
```

---

## 📋 Checklist for Full Migration

- [ ] Update `.env` file with actual API keys
- [ ] Test new endpoints with cURL or Postman
- [ ] Update frontend to use new endpoint URLs and response format
- [ ] Monitor logs: `npm run logs`
- [ ] Remove old routes once fully migrated
- [ ] Add unit tests for services
- [ ] Setup CI/CD pipeline

---

## 🔄 Backwards Compatibility

**Old endpoints still work** during migration period:
- `/api/brat` → Old brat route
- `/api/ytmp3` → Old YouTube route
- `/api/tiktok` → Old TikTok route
- etc.

These will be removed in v3.0. **Please migrate to new endpoints**.

---

## 📝 Example: Adding a New Feature

### 1. Create Validation Schema
**File:** `src/shared/validators/myServiceSchemas.js`
```javascript
const Joi = require('joi');
module.exports = {
  myActionSchema: Joi.object({
    param1: Joi.string().required(),
    param2: Joi.number().optional(),
  }),
};
```

### 2. Create Service
**File:** `src/core/media/myservice/myservice.service.js`
```javascript
class MyService {
  async myAction(params) {
    // Business logic here
    return result;
  }
}
module.exports = new MyService();
```

### 3. Create Controller
**File:** `src/core/media/myservice/myservice.controller.js`
```javascript
class MyController {
  async myAction(req, res, next) {
    const result = await myService.myAction(req.validated);
    return ResponseHandler.success(res, result);
  }
}
module.exports = new MyController();
```

### 4. Create Routes
**File:** `src/core/media/myservice/myservice.routes.js`
```javascript
router.post('/action', validateRequest(schemas.myActionSchema), asyncHandler(controller.myAction));
```

### 5. Register in server.js
```javascript
app.use('/api/myservice', apiLimiter, myServiceRoutes);
```

Done! Your new feature follows the clean architecture.

---

## 🐛 Debugging

### Enable Debug Logging
```bash
NODE_ENV=development npm run dev
```

### Check Error in Logs
```bash
tail -f logs/error.log
```

### Common Issues

**Issue:** `GEMINI_API_KEY not configured`
- Solution: Add `GEMINI_API_KEY` to `.env`

**Issue:** Chrome not found
- Solution: Install Chrome or update `CHROME_BIN` in `.env`

**Issue:** Rate limit exceeded
- Solution: Wait or adjust `RATE_LIMIT_MAX_REQUESTS` in `.env`

---

## 📚 Resources

- Express.js docs: https://expressjs.com
- Joi validation: https://joi.dev
- Custom error handling: Clean Architecture principles

---

## ✅ Monitoring Checklist

After deployment, verify:
- [ ] Health check returns 200: `GET /health`
- [ ] API status works: `GET /api/status`
- [ ] Logs directory created: `logs/`
- [ ] All new endpoints respond correctly
- [ ] Rate limiting works
- [ ] Error responses are consistent
- [ ] Old endpoints still work (backwards compatible)

---

**Migration Date:** April 9, 2026
**Refactored By:** Copilot
**Status:** ✅ Complete & Ready
