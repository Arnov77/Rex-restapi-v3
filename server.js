const express = require('express');
const path = require('path');
const dotenv = require('dotenv');

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

// Register routes
app.use('/api/brat', bratRoute);
app.use('/api/bratvid', bratVidRoute);
app.use('/api/ytmp3', ytmp3Route);
app.use('/api/ytmp4', ytmp4Route);
app.use('/api/ytplay', ytplayRoute);
app.use('/api/hitam', hitamRoute);

// Start server
app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
