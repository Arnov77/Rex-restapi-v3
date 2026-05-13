const tf = require('@tensorflow/tfjs');
const nsfwjs = require('nsfwjs');
const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ffmpeg = require('fluent-ffmpeg');
const { env } = require('../../../../config');
const { AppError, ValidationError } = require('../../../shared/utils/errors');

const DEFAULT_MODEL_DIR = path.join(__dirname, '../../../../public/models/nsfw/mobilenet_v2');
const NSFW_CLASSES = new Set(['hentai', 'porn', 'sexy']);
const SAFE_CLASSES = new Set(['drawing', 'neutral']);

let modelPromise = null;

tf.enableProdMode();

function normalizeLabel(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function getModelUrl() {
  return env.NSFW_MODEL_URL || DEFAULT_MODEL_DIR;
}

async function createLocalModelIOHandler(modelDir = DEFAULT_MODEL_DIR) {
  return {
    load: async () => {
      const modelJsonPath = path.join(modelDir, 'model.json');
      const modelJson = JSON.parse(await fs.readFile(modelJsonPath, 'utf8'));
      const manifest = modelJson.weightsManifest || [];
      const weightSpecs = manifest.flatMap((group) => group.weights || []);
      const buffers = [];

      for (const group of manifest) {
        for (const shardPath of group.paths || []) {
          buffers.push(await fs.readFile(path.join(modelDir, shardPath)));
        }
      }

      const weightBuffer = Buffer.concat(buffers);
      return {
        modelTopology: modelJson.modelTopology,
        weightSpecs,
        weightData: weightBuffer.buffer.slice(
          weightBuffer.byteOffset,
          weightBuffer.byteOffset + weightBuffer.byteLength
        ),
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
      };
    },
  };
}

async function getModel() {
  if (!modelPromise) {
    modelPromise = (async () => {
      await tf.setBackend('cpu');
      await tf.ready();
      const modelSource = env.NSFW_MODEL_URL || (await createLocalModelIOHandler());
      return nsfwjs.load(modelSource, { size: env.NSFW_IMAGE_SIZE });
    })().catch((err) => {
      modelPromise = null;
      throw new AppError(`Failed to load NSFWJS model: ${err.message}`, 502);
    });
  }

  return modelPromise;
}

async function imageBufferToTensor(buffer) {
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(env.NSFW_IMAGE_SIZE, env.NSFW_IMAGE_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels], 'int32');
  } catch (err) {
    throw new ValidationError(`Invalid image: ${err.message}`);
  }
}

function normalizePredictions(payload, threshold) {
  const predictions = (Array.isArray(payload) ? payload : [])
    .map((item) => ({
      label: normalizeLabel(item.className ?? item.label ?? item.class ?? item.name),
      score: Number(item.probability ?? item.score ?? item.confidence),
    }))
    .filter((item) => item.label && Number.isFinite(item.score))
    .map((item) => ({ ...item, score: Math.max(0, Math.min(1, item.score)) }))
    .sort((a, b) => b.score - a.score);

  if (!predictions.length) {
    throw new AppError('NSFWJS returned an unsupported response format', 502);
  }

  const nsfwScore = Math.min(
    1,
    predictions
      .filter((item) => NSFW_CLASSES.has(item.label))
      .reduce((sum, item) => sum + item.score, 0)
  );
  const safeScore = Math.min(
    1,
    predictions
      .filter((item) => SAFE_CLASSES.has(item.label))
      .reduce((sum, item) => sum + item.score, 0)
  );

  return {
    isNsfw: nsfwScore >= threshold,
    nsfwScore,
    safeScore,
    threshold,
    label: predictions[0].label,
    predictions,
  };
}

async function detectImage(buffer, { threshold } = {}) {
  if (!buffer?.length) {
    throw new ValidationError('Image is required');
  }

  const resolvedThreshold = threshold ?? env.NSFW_THRESHOLD;
  const model = await getModel();
  const tensor = await imageBufferToTensor(buffer);

  try {
    const predictions = await model.classify(tensor, 5);
    return normalizePredictions(predictions, resolvedThreshold);
  } finally {
    tensor.dispose();
  }
}

function mediaKind(contentType = '') {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('image/gif')) return 'gif';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('image/')) return 'image';
  return 'unknown';
}

function extensionForContentType(contentType = '') {
  const normalized = contentType.toLowerCase();
  if (normalized.includes('image/gif')) return '.gif';
  if (normalized.includes('webm')) return '.webm';
  if (normalized.includes('quicktime')) return '.mov';
  if (normalized.includes('x-msvideo')) return '.avi';
  if (normalized.startsWith('video/')) return '.mp4';
  if (normalized.includes('png')) return '.png';
  if (normalized.includes('webp')) return '.webp';
  return '.jpg';
}

async function extractFrames(buffer, contentType) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rex-nsfw-'));
  const inputPath = path.join(tmpDir, `input${extensionForContentType(contentType)}`);
  const outputPattern = path.join(tmpDir, 'frame-%03d.jpg');

  try {
    await fs.writeFile(inputPath, buffer);
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions([
          `-vf fps=1/${env.NSFW_FRAME_INTERVAL_SEC},scale=${env.NSFW_IMAGE_SIZE}:${env.NSFW_IMAGE_SIZE}:force_original_aspect_ratio=decrease`,
          `-vframes ${env.NSFW_MAX_FRAMES}`,
          '-q:v 3',
        ])
        .output(outputPattern)
        .on('end', resolve)
        .on('error', (err) =>
          reject(new AppError(`ffmpeg frame extract failed: ${err.message}`, 500))
        )
        .run();
    });

    const files = (await fs.readdir(tmpDir))
      .filter((file) => /^frame-\d+\.jpg$/i.test(file))
      .sort();

    if (!files.length) {
      throw new ValidationError('No frames could be extracted from the media file');
    }

    const frames = [];
    for (const [index, file] of files.entries()) {
      frames.push({
        index,
        timeSec: index * env.NSFW_FRAME_INTERVAL_SEC,
        buffer: await fs.readFile(path.join(tmpDir, file)),
      });
    }
    return frames;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function aggregateFrameResults(frameResults, threshold, kind) {
  const maxFrame = frameResults.reduce(
    (best, frame) => (!best || frame.nsfwScore > best.nsfwScore ? frame : best),
    null
  );
  const minSafeScore = frameResults.reduce((min, frame) => Math.min(min, frame.safeScore), 1);
  const nsfwFrames = frameResults.filter((frame) => frame.isNsfw).length;

  return {
    mediaType: kind,
    isNsfw: Boolean(maxFrame && maxFrame.nsfwScore >= threshold),
    nsfwScore: maxFrame?.nsfwScore || 0,
    safeScore: minSafeScore,
    threshold,
    label: maxFrame?.label || 'unknown',
    analyzedFrames: frameResults.length,
    nsfwFrames,
    maxFrame: maxFrame
      ? {
          index: maxFrame.index,
          timeSec: maxFrame.timeSec,
          label: maxFrame.label,
          nsfwScore: maxFrame.nsfwScore,
          safeScore: maxFrame.safeScore,
          predictions: maxFrame.predictions,
        }
      : null,
    frames: frameResults,
  };
}

async function detectAnimatedMedia(buffer, { contentType, threshold } = {}) {
  const resolvedThreshold = threshold ?? env.NSFW_THRESHOLD;
  const kind = mediaKind(contentType);
  const frames = await extractFrames(buffer, contentType);
  const frameResults = [];

  for (const frame of frames) {
    const result = await detectImage(frame.buffer, { threshold: resolvedThreshold });
    frameResults.push({
      index: frame.index,
      timeSec: frame.timeSec,
      isNsfw: result.isNsfw,
      nsfwScore: result.nsfwScore,
      safeScore: result.safeScore,
      label: result.label,
      predictions: result.predictions,
    });
  }

  return aggregateFrameResults(frameResults, resolvedThreshold, kind);
}

async function detectMedia(buffer, { contentType = 'image/jpeg', threshold } = {}) {
  const kind = mediaKind(contentType);
  if (kind === 'video' || kind === 'gif') {
    return detectAnimatedMedia(buffer, { contentType, threshold });
  }

  const result = await detectImage(buffer, { threshold });
  return { mediaType: 'image', analyzedFrames: 1, ...result };
}

module.exports = {
  aggregateFrameResults,
  detectImage,
  detectMedia,
  createLocalModelIOHandler,
  extractFrames,
  getModelUrl,
  imageBufferToTensor,
  mediaKind,
  normalizePredictions,
};
