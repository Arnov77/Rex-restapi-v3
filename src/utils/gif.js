async function createGIF(frames) {
  const GIFEncoder = require('gifencoder');
  const { createCanvas, loadImage } = require('canvas');

  const encoder = new GIFEncoder(512, 512);
  encoder.start();
  encoder.setRepeat(0);
  encoder.setDelay(500);
  encoder.setQuality(10);

  const canvas = createCanvas(512, 512);
  const ctx = canvas.getContext('2d');

  for (const frame of frames) {
    const img = await loadImage(frame);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    encoder.addFrame(ctx);
  }

  encoder.finish();
  return encoder.out.getData();
}

module.exports = { createGIF };
