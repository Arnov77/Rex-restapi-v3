const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const logger = require('../shared/utils/logger');

async function createGIF(frames) {
  return new Promise((resolve, reject) => {
    try {
      if (!frames || frames.length === 0) {
        throw new Error('No frames provided');
      }

      logger.info(`[GIF] Creating GIF from ${frames.length} frames using ffmpeg`);

      // Create unique temp directory per request
      const uniqueId = Date.now();
      const tempDir = path.join(__dirname, `../../temp/gif-${uniqueId}`);
      
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const framePaths = frames.map((buffer, idx) => {
        const framePath = path.join(tempDir, `frame-${idx.toString().padStart(3, '0')}.png`);
        fs.writeFileSync(framePath, buffer);
        return framePath;
      });

      logger.info(`[GIF] Saved ${framePaths.length} temp frames to ${tempDir}`);

      // Use ffmpeg to create GIF from frames
      const outputGif = path.join(tempDir, `output.gif`);
      const inputPattern = path.join(tempDir, 'frame-%03d.png');

      ffmpeg()
        .input(inputPattern)
        .inputFPS(2) // 2 frames per second = 500ms per frame
        .output(outputGif)
        .outputOptions('-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2') // Ensure even dimensions
        .on('start', (cmd) => {
          logger.info(`[GIF] FFmpeg command: ${cmd}`);
        })
        .on('progress', (progress) => {
          logger.info(`[GIF] FFmpeg progress: ${progress.percent}%`);
        })
        .on('error', (err) => {
          logger.error(`[GIF] FFmpeg error: ${err.message}`);
          // Cleanup on error
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch (e) {}
          reject(new Error(`GIF creation failed: ${err.message}`));
        })
        .on('end', () => {
          try {
            const gifBuffer = fs.readFileSync(outputGif);
            logger.success(`[GIF] Successfully created GIF (${(gifBuffer.length / 1024 / 1024).toFixed(2)} MB)`);
            
            // Cleanup
            fs.rmSync(tempDir, { recursive: true, force: true });
            
            resolve(gifBuffer);
          } catch (e) {
            logger.error(`[GIF] Cleanup error: ${e.message}`);
            reject(new Error(`Failed to read GIF output: ${e.message}`));
          }
        })
        .run();
    } catch (error) {
      logger.error(`[GIF] Creation failed: ${error.message}`);
      reject(new Error(`GIF creation failed: ${error.message}`));
    }
  });
}

module.exports = { createGIF };
