const express = require('express');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

dotenv.config();
const app = express();
const PORT = process.env.PORT || 7680;

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files (HTML, CSS, JS)

// Routes
const bratRoute = require('./src/routes/brat');
const bratVidRoute = require('./src/routes/bratVid');
const ytmp3Route = require('./src/routes/ytmp3');
const ytmp4Route = require('./src/routes/ytmp4');
const ytplayRoute = require('./src/routes/ytplay');
const hitamRoute = require('./src/routes/hitam');
const ttdlRoute = require('./src/routes/tiktok');
const ttmp3Route = require('./src/routes/tiktok-mp3');
const igdlRoute = require('./src/routes/instagram');

// Register routes
app.use('/api/brat', bratRoute);
app.use('/api/bratvid', bratVidRoute);
app.use('/api/ytmp3', ytmp3Route);
app.use('/api/ytmp4', ytmp4Route);
app.use('/api/ytplay', ytplayRoute);
app.use('/api/hitam', hitamRoute);
app.use('/api/tiktok', ttdlRoute);
app.use('/api/tiktok-mp3', ttmp3Route);
app.use('/api/instagram', igdlRoute);
app.use('/api/facebook', require('./src/routes/facebook'));

// Start server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
