const { detectSchema } = require('../src/core/tools/nsfw/nsfw.schemas');
const {
  aggregateFrameResults,
  getModelUrl,
  mediaKind,
  normalizePredictions,
} = require('../src/core/tools/nsfw/nsfw.service');
const fs = require('fs');
const path = require('path');

describe('detectSchema', () => {
  it('accepts an HTTPS image URL with an optional threshold', () => {
    const { error, value } = detectSchema.validate({
      imageUrl: 'https://example.com/photo.jpg',
      threshold: 0.8,
    });

    expect(error).toBeUndefined();
    expect(value.threshold).toBe(0.8);
  });

  it('rejects non-HTTPS image URLs', () => {
    const { error } = detectSchema.validate({ imageUrl: 'http://example.com/photo.jpg' });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/HTTPS/i);
  });

  it('rejects thresholds outside 0..1', () => {
    const { error } = detectSchema.validate({ threshold: 1.2 });
    expect(error).toBeDefined();
  });
});

describe('normalizePredictions', () => {
  it('normalizes NSFWJS class predictions', () => {
    const result = normalizePredictions(
      [
        { className: 'Neutral', probability: 0.42 },
        { className: 'Porn', probability: 0.31 },
        { className: 'Hentai', probability: 0.11 },
        { className: 'Drawing', probability: 0.08 },
        { className: 'Sexy', probability: 0.08 },
      ],
      0.5
    );

    expect(result).toMatchObject({
      isNsfw: true,
      nsfwScore: 0.5,
      safeScore: 0.5,
      label: 'neutral',
    });
  });

  it('treats drawing and neutral as safe classes', () => {
    const result = normalizePredictions(
      [
        { className: 'Neutral', probability: 0.7 },
        { className: 'Drawing', probability: 0.2 },
        { className: 'Sexy', probability: 0.1 },
      ],
      0.7
    );

    expect(result.isNsfw).toBe(false);
    expect(result.safeScore).toBeCloseTo(0.9);
    expect(result.nsfwScore).toBe(0.1);
  });
});

describe('animated media helpers', () => {
  it('detects supported media kinds from content type', () => {
    expect(mediaKind('image/jpeg')).toBe('image');
    expect(mediaKind('image/gif')).toBe('gif');
    expect(mediaKind('video/mp4')).toBe('video');
    expect(mediaKind('application/octet-stream')).toBe('unknown');
  });

  it('aggregates frame results by the highest NSFW score', () => {
    const result = aggregateFrameResults(
      [
        {
          index: 0,
          timeSec: 0,
          isNsfw: false,
          nsfwScore: 0.2,
          safeScore: 0.8,
          label: 'neutral',
          predictions: [],
        },
        {
          index: 1,
          timeSec: 2,
          isNsfw: true,
          nsfwScore: 0.91,
          safeScore: 0.09,
          label: 'porn',
          predictions: [],
        },
      ],
      0.7,
      'video'
    );

    expect(result).toMatchObject({
      mediaType: 'video',
      isNsfw: true,
      nsfwScore: 0.91,
      safeScore: 0.09,
      analyzedFrames: 2,
      nsfwFrames: 1,
      label: 'porn',
      maxFrame: { index: 1, timeSec: 2 },
    });
  });
});

describe('model configuration', () => {
  it('uses the bundled NSFWJS model by default', () => {
    expect(getModelUrl()).toMatch(/public[\\/]+models[\\/]+nsfw[\\/]+mobilenet_v2$/);
  });

  it('bundles every model shard referenced by model.json', () => {
    const modelDir = getModelUrl();
    const modelJson = JSON.parse(fs.readFileSync(path.join(modelDir, 'model.json'), 'utf8'));
    const shardPaths = modelJson.weightsManifest.flatMap((group) => group.paths);

    expect(shardPaths.length).toBeGreaterThan(0);
    for (const shardPath of shardPaths) {
      const fullPath = path.join(modelDir, shardPath);
      expect(fs.existsSync(fullPath)).toBe(true);
      expect(fs.statSync(fullPath).size).toBeGreaterThan(0);
    }
  });
});
