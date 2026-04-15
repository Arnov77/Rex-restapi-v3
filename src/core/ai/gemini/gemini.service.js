const axios = require('axios');
const Replicate = require('replicate');
const logger = require('../../../shared/utils/logger');
const { AppError, NotFoundError } = require('../../../shared/utils/errors');

/**
 * Replicate Image Generation Service
 * Uses Stable Diffusion SDXL to generate anime character images
 * with style modifications (dark skin or nerd accessories).
 */
class ReplicateImageService {
  constructor() {
    this.token = process.env.REPLICATE_API_TOKEN;
    if (!this.token) {
      throw new Error('REPLICATE_API_TOKEN is not configured');
    }
    this.replicate = new Replicate({
      auth: this.token,
    });
    // Latest SDXL version
    this.sdxlModel = 'stability-ai/sdxl:7762fd07cf82c948538e41f63f77d685e02b063e37e496e96eefd46c929f9bdc';
  }

  /**
   * Generate nerdy anime image using Replicate SDXL
   * @param {string} imageUrl - URL of reference image (not used, placeholder parameter)
   * @param {string} option   - 'nerd'
   * @returns {Promise<Buffer>} Generated image buffer
   */
  async generateModifiedImage(imageUrl, option) {
    const validOptions = ['nerd'];
    if (!validOptions.includes(option)) {
      throw new NotFoundError("Option must be 'nerd'");
    }

    logger.info(`[Replicate] Generating anime character — option: ${option}`);

    const prompt = this._getPrompt(option);
    const negativePrompt = 'blurry, low quality, watermark, distorted, deformed, bad anatomy, poorly drawn';

    try {
      const output = await this.replicate.run(this.sdxlModel, {
        input: {
          prompt: prompt,
          negative_prompt: negativePrompt,
          num_outputs: 1,
          scheduler: 'K_EULER_ANCESTRAL',
          num_inference_steps: 50,
          guidance_scale: 7.5,
          width: 768,
          height: 768,
          seed: Math.floor(Math.random() * 1000000),
        },
      });

      logger.info(`[Replicate] Image generated successfully — option: ${option}`);

      // output is an array with image URLs
      if (!output || !Array.isArray(output) || output.length === 0) {
        throw new AppError('Failed to generate image - no output from Replicate', 502);
      }

      const resultImageUrl = output[0];
      logger.info(`[Replicate] Downloading generated image...`);

      const resultResp = await axios.get(resultImageUrl, { responseType: 'arraybuffer' });
      return Buffer.from(resultResp.data);
    } catch (err) {
      if (err instanceof AppError) throw err;
      logger.error(`[Replicate] Generation failed: ${err.message}`);
      throw new AppError(`Image generation failed: ${err.message}`, 502);
    }
  }

  /** Prompt per opsi */
  _getPrompt(option) {
    const baseDescription = 
      'beautiful anime character, detailed face, expressive eyes, anime style art, ' +
      'high quality, clean illustration, intricate details, professional animation';

    const prompts = {
      nerd:
        `${baseDescription}. ` +
        'Nerdy anime character. ' +
        'Wearing large thick black-framed glasses that cover part of the face. ' +
        'Exaggerated buck teeth visible in a geeky smile. ' +
        'Wearing a hoodie or gaming shirt. ' +
        'Background shows anime posters, manga, books. ' +
        'Very nerdy otaku appearance. ' +
        'Professional anime art style illustration',
    };
    return prompts[option];
  }
}

module.exports = new ReplicateImageService();
