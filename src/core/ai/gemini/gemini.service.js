const axios = require('axios');
const mime = require('mime-types');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('../../../shared/utils/logger');
const { AppError, NotFoundError } = require('../../../shared/utils/errors');

/**
 * Gemini AI Service
 * Handles AI image generation and manipulation
 */
class GeminiService {
  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY;
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }
    this.genAI = new GoogleGenerativeAI(this.apiKey);
  }

  /**
   * Generate modified image using Gemini
   * @param {string} imageUrl - URL of image to modify
   * @param {string} option - Modification type ('nerd' or 'hitam')
   * @returns {Promise<Buffer>} Modified image buffer
   */
  async generateModifiedImage(imageUrl, option) {
    try {
      logger.info(`[Gemini] Generating modified image with option: ${option}`);

      // Validate option
      const validOptions = ['nerd', 'hitam'];
      if (!validOptions.includes(option)) {
        throw new NotFoundError("Option must be 'nerd' or 'hitam'");
      }

      // Download image
      const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const mimeType = response.headers['content-type'];
      const buffer = Buffer.from(response.data);
      const base64 = buffer.toString('base64');

      // Generate prompt based on option
      const prompt = this._getPrompt(option);

      // Call Gemini API
      const model = this.genAI.getGenerativeModel({
        model: 'gemini-2.5-flash-image',
      });

      const generationConfig = {
        temperature: 1,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 8192,
        responseModalities: ['image', 'text'],
        responseMimeType: 'text/plain',
      };

      const result = await model.generateContent({
        generationConfig,
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
      });

      // Extract image from response
      const candidates = result.response.candidates;
      if (!candidates || candidates.length === 0) {
        throw new AppError('No response from Gemini', 500);
      }

      const part = candidates[0].content.parts.find((p) => p.inlineData);

      if (!part) {
        throw new AppError('Failed to generate image', 500);
      }

      const resultBuffer = Buffer.from(part.inlineData.data, 'base64');

      logger.success(`[Gemini] Image generated successfully with option: ${option}`);
      return resultBuffer;

    } catch (error) {
      logger.error(`[Gemini] Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Helper: Generate prompt based on option
   */
  _getPrompt(option) {
    const prompts = {
      nerd: "Ubah karakter anime ini menjadi terlihat seperti 'nerd'. " +
            "Tambahkan kacamata besar berwarna hitam, gigi depan besar (gigi kelinci), dan ekspresi wajah kikuk seperti nerd. " +
            "Selain itu, ubah warna kulitnya menjadi hitam, tapi pertahankan detail, tekstur, dan shading alami agar tetap realistis. " +
            "Jangan ubah rambut atau pakaian, dan biarkan latar belakang tetap seperti aslinya.",
      
      hitam: "Ubah karakter anime ini menjadi memiliki warna kulit hitam. " +
             "Pertahankan detail, tekstur, dan shading alami agar tetap realistis. " +
             "Jangan ubah rambut, pakaian, atau latar belakang.",
    };

    return prompts[option] || prompts.hitam;
  }
}

module.exports = new GeminiService();
