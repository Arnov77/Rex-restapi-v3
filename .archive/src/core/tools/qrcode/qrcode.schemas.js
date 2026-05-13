const Joi = require('joi');

const generateSchema = Joi.object({
  text: Joi.string().min(1).max(2953).required().messages({
    'string.empty': 'text cannot be empty',
    'string.max': 'text cannot exceed 2953 characters (QR code limit)',
    'any.required': 'text parameter is required',
  }),
  size: Joi.number().integer().min(100).max(2000).default(400).messages({
    'number.min': 'size must be at least 100px',
    'number.max': 'size cannot exceed 2000px',
  }),
  margin: Joi.number().integer().min(0).max(10).default(2).messages({
    'number.max': 'margin cannot exceed 10 modules',
  }),
  darkColor: Joi.string()
    .pattern(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .default('#000000')
    .messages({ 'string.pattern.base': 'darkColor must be a valid hex color (e.g. #000000)' }),
  lightColor: Joi.string()
    .pattern(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .default('#ffffff')
    .messages({ 'string.pattern.base': 'lightColor must be a valid hex color (e.g. #ffffff)' }),
  errorCorrectionLevel: Joi.string().valid('L', 'M', 'Q', 'H').default('M').messages({
    'any.only': 'errorCorrectionLevel must be one of: L, M, Q, H',
  }),
  format: Joi.string().valid('png', 'svg').default('png').messages({
    'any.only': 'format must be one of: png, svg',
  }),
});

module.exports = { generateSchema };
