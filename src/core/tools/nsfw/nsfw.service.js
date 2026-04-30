const tf = require('@tensorflow/tfjs');
const nsfwjs = require('nsfwjs');
const sharp = require('sharp');
const fs = require('fs/promises');
const path = require('path');
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

module.exports = {
  detectImage,
  createLocalModelIOHandler,
  getModelUrl,
  imageBufferToTensor,
  normalizePredictions,
};
