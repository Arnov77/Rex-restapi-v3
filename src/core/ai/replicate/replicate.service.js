const axios = require('axios');
const Replicate = require('replicate');
const logger = require('../../../shared/utils/logger');
const { AppError, NotFoundError } = require('../../../shared/utils/errors');

// Stable Diffusion XL. Pinned to a known version so output doesn't drift
// silently when Replicate retags `latest`.
const SDXL_MODEL =
  'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';

const NEGATIVE_PROMPT =
  'blurry, low quality, watermark, distorted, deformed, bad anatomy, poorly drawn';

const BASE_DESCRIPTION =
  'beautiful anime character, detailed face, expressive eyes, anime style art, ' +
  'high quality, clean illustration, intricate details, professional animation';

const PROMPTS = {
  nerd:
    `${BASE_DESCRIPTION}. ` +
    'Nerdy anime character. ' +
    'Wearing large thick black-framed glasses that cover part of the face. ' +
    'Exaggerated buck teeth visible in a geeky smile. ' +
    'Wearing a hoodie or gaming shirt. ' +
    'Background shows anime posters, manga, books. ' +
    'Very nerdy otaku appearance. ' +
    'Professional anime art style illustration',
};

// Lazy client: constructing `new Replicate({ auth: undefined })` throws at
// import time, which previously crashed the entire boot even if no /api/
// replicate request was ever made. Re-read the token on every call so a
// later-set env works without a restart.
let cachedClient = null;
let cachedToken = null;

function getClient() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new AppError('Replicate is unavailable (REPLICATE_API_TOKEN not configured)', 503);
  }
  if (cachedClient && cachedToken === token) return cachedClient;
  cachedClient = new Replicate({ auth: token });
  cachedToken = token;
  return cachedClient;
}

async function generateModifiedImage(imageUrl, option) {
  if (!PROMPTS[option]) {
    throw new NotFoundError("Option must be 'nerd'");
  }

  logger.info(`[Replicate] Generating anime character — option: ${option}`);

  const client = getClient();
  let output;
  try {
    output = await client.run(SDXL_MODEL, {
      input: {
        prompt: PROMPTS[option],
        negative_prompt: NEGATIVE_PROMPT,
        num_outputs: 1,
        scheduler: 'K_EULER_ANCESTRAL',
        num_inference_steps: 50,
        guidance_scale: 7.5,
        width: 768,
        height: 768,
        seed: Math.floor(Math.random() * 1_000_000),
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error(`[Replicate] Generation failed: ${err.message}`);
    throw new AppError(`Image generation failed: ${err.message}`, 502);
  }

  if (!output || !Array.isArray(output) || output.length === 0) {
    throw new AppError('Failed to generate image - no output from Replicate', 502);
  }

  logger.info('[Replicate] Downloading generated image...');
  const resultResp = await axios.get(output[0], { responseType: 'arraybuffer', timeout: 30_000 });
  return Buffer.from(resultResp.data);
}

module.exports = { generateModifiedImage };
