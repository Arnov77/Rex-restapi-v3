const Joi = require('joi');

/**
 * Gemini/AI service validation schemas
 */

const generateImageSchema = Joi.object({
  image: Joi.string()
    .uri()
    .required()
    .messages({
      'string.uri': 'Image must be a valid URL',
      'any.required': 'Image URL is required',
    }),

  option: Joi.string()
    .valid('nerd', 'hitam')
    .required()
    .messages({
      'any.only': "Option must be 'nerd' or 'hitam'",
      'any.required': 'Option parameter is required',
    }),
});

module.exports = {
  generateImageSchema,
};
