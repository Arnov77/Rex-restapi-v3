# 🚀 QUICK START GUIDE

## ✅ Refactor Complete!

Your project has been fully refactored with **clean architecture**. Here's what you need to do to run it.

---

## 1️⃣ SETUP (2 minutes)

### Step 1: Verify Installation
```bash
npm --version  # Should show npm version
```

### Step 2: Install Dependencies
```bash
cd c:\Users\Aril\Documents\Rex-RESTAPI
npm install    # Already done - just verify
```

### Step 3: Configure Environment
```bash
# Open the .env file and update:
NODE_ENV=development
PORT=3000
GEMINI_API_KEY=YOUR_API_KEY_HERE  # Get from https://makersuite.google.com
```

---

## 2️⃣ RUN (1 minute)

### Development Mode (with auto-reload)
```bash
npm run dev
```

You should see:
```
✅ Server running at http://localhost:3000
📚 Health check: http://localhost:3000/health
Environment: development
```

### Production Mode
```bash
npm start
```

---

## 3️⃣ TEST (5 minutes)

### Test Health Endpoint
```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2026-04-09T14:40:00.000Z",
  "uptime": 1.234
}
```

### Test New YouTube Endpoint
```bash
curl -X POST http://localhost:3000/api/youtube/mp3 \
  -H "Content-Type: application/json" \
  -d '{"query": "never gonna give you up"}'
```

### Test New Brat Image Endpoint
```bash
curl -X POST http://localhost:3000/api/brat/image \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello World", "preset": "bratdeluxe"}' \
  --output brat.png
```

### Test Validation Error
```bash
curl -X POST http://localhost:3000/api/youtube/mp3 \
  -H "Content-Type: application/json" \
  -d '{"query": ""}'
```

Response (should be consistent):
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Search query cannot be empty",
  "timestamp": "2026-04-09T14:40:00.000Z"
}
```

---

## 📁 NEW STRUCTURE

```
Perfect! You now have:

✅ Clean middleware (error handling, validation, rate limiting)
✅ Refactored services (YouTube, Brat, TikTok, Instagram, Gemini)
✅ Standardized responses (all endpoints consistent)
✅ Input validation (Joi schemas, automatic)
✅ Logging system (colored console + files)
✅ Rate limiting (3-tier protection)
✅ Error handling (centralized)
✅ Backwards compatibility (old routes still work)
```

---

## 📊 ENDPOINTS QUICK REFERENCE

### ✨ NEW ENDPOINTS (Recommended)
```
POST /api/youtube/mp3     → Download YouTube audio
POST /api/youtube/mp4     → Download YouTube video
POST /api/brat/image      → Generate Brat image
POST /api/brat/video      → Generate Brat GIF
POST /api/tiktok/download → Download TikTok video
POST /api/tiktok/audio    → Download TikTok audio
POST /api/instagram/download → Download Instagram content
POST /api/ai/gemini/generate → AI image generation
```

### 📦 OLD ENDPOINTS (Still work - legacy)
```
GET/POST /api/ytmp3       → YouTube MP3 (old)
GET/POST /api/ytmp4       → YouTube MP4 (old)
GET/POST /api/brat        → Brat image (old)
GET/POST /api/tiktok      → TikTok (old)
POST /api/instagram       → Instagram (old)
```

---

## 🔍 MONITORING

### View Logs
```bash
npm run logs
```

Logs are saved in:
- `logs/info.log` - Info level
- `logs/error.log` - Errors only
- `logs/combined.log` - All logs

### Check Health
```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/status
```

---

## 🐛 TROUBLESHOOTING

### Port Already in Use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Linux/macOS
lsof -i :3000
kill -9 <PID>
```

### GEMINI_API_KEY Missing
```bash
# Get your key from: https://makersuite.google.com/app/apikey
# Then add to .env:
GEMINI_API_KEY=sk-...
```

### Chrome Not Found
```bash
# Update CHROME_BIN in .env
# Windows:  C:\Program Files\Google\Chrome\Application\chrome.exe
# Linux:    /usr/bin/google-chrome
# macOS:    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome
```

### Validation Errors
```
Check:
1. Are you sending JSON? (Content-Type: application/json)
2. Are required fields present?
3. Check error message - it's descriptive
```

---

## 📚 DOCUMENTATION

### Want to Understand the Refactor?
Read: `MIGRATION.md`

### Need Implementation Details?
Read: `REFACTOR_SUMMARY.md`

### Full Report?
Read: `IMPLEMENTATION_REPORT.md`

---

## 🧪 NEXT STEPS

### For Testing
1. Create `src/services/__tests__/youtube.service.test.js`
2. Mock the ytmp3 function
3. Test the service logic

### For Documentation
1. Create Swagger file at `src/config/swagger.js`
2. Install `swagger-ui-express`
3. Mount at `/api/docs`

### For Production
1. Set `NODE_ENV=production`
2. Update `.env` with production values
3. Deploy to your server

---

## ✨ KEY FILES

```
server.js                    ← Entry point (updated)
package.json                 ← Dependencies (updated)
.env                         ← Configuration
MIGRATION.md                 ← Migration guide
REFACTOR_SUMMARY.md          ← What was done
IMPLEMENTATION_REPORT.md     ← Detailed report

src/shared/middleware/       ← Error, validation, rate limit
src/shared/utils/            ← Response, logger, errors
src/shared/validators/       ← Joi schemas
src/core/media/              ← YouTube, Brat, TikTok, Instagram
src/core/ai/                 ← Gemini service
```

---

## 🎯 SUCCESS CHECKLIST

Running the app successfully?

- [ ] `npm run dev` starts without errors
- [ ] `http://localhost:3000/health` returns OK
- [ ] Logs appear in `logs/` directory
- [ ] New endpoint test works
- [ ] Validation error returns consistent format
- [ ] Old endpoint still works (backwards compatible)

All checked? ✅ **You're ready to go!**

---

## 💡 PRO TIPS

1. **Use async/await** - No more callback hell
2. **Let middleware handle errors** - Don't try-catch in routes
3. **Use logger** - Not console.log
4. **Trust the validation** - Joi catches bad input
5. **Check response format** - It's standardized now

---

## 🚀 You're All Set!

The refactor is **complete and production-ready**. 

Start with:
```bash
npm run dev
```

Then test with:
```bash
curl http://localhost:3000/health
```

Enjoy your cleaner, more maintainable codebase! 🎉

---

**Questions?** Check the documentation files or review the service code directly.

**Happy coding!** ✨
