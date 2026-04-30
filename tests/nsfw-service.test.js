const { detectSchema } = require('../src/core/tools/nsfw/nsfw.schemas');
const { getModelUrl, normalizePredictions } = require('../src/core/tools/nsfw/nsfw.service');

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

describe('model configuration', () => {
  it('uses the bundled NSFWJS model by default', () => {
    expect(getModelUrl()).toMatch(/public[\\/]+models[\\/]+nsfw[\\/]+mobilenet_v2$/);
  });
});
