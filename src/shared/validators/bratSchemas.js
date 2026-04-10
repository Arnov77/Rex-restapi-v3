const Joi = require('joi');

/**
 * Brat image/video generation validation schemas
 */

const VALID_PRESETS = ['brat', 'bratdeluxe', 'custom'];
const COLOR_REGEX = /^(#[0-9A-Fa-f]{6}|[a-zA-Z]+)$/;

const generateBratSchema = Joi.object({
  text: Joi.string()
    .min(1)
    .max(500)
    .required()
    .trim()
    .messages({
      'string.empty': 'Text cannot be empty',
      'string.max': 'Text too long (max 500 chars)',
      'any.required': 'Text is required',
    }),

  preset: Joi.string()
    .valid(...VALID_PRESETS)
    .default('bratdeluxe'),

  bgColor: Joi.string()
    .pattern(COLOR_REGEX)
    .optional()
    .messages({
      'string.pattern.base': 'Invalid color format (hex or name)',
    }),

  textColor: Joi.string()
    .pattern(COLOR_REGEX)
    .optional(),
});

module.exports = {
  generateBratSchema,
};
