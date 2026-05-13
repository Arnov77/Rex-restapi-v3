const Joi = require('joi');

const screenshotSchema = Joi.object({
  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      'string.uri': 'URL must be a valid http or https URL',
      'any.required': 'url parameter is required',
    }),
  width: Joi.number().integer().min(320).max(3840).default(1280).messages({
    'number.min': 'Width must be at least 320px',
    'number.max': 'Width cannot exceed 3840px',
  }),
  height: Joi.number().integer().min(240).max(2160).default(720).messages({
    'number.min': 'Height must be at least 240px',
    'number.max': 'Height cannot exceed 2160px',
  }),
  fullPage: Joi.boolean().default(false),
  format: Joi.string().valid('png', 'jpeg', 'webp').default('png').messages({
    'any.only': 'Format must be one of: png, jpeg, webp',
  }),
  quality: Joi.number().integer().min(1).max(100).default(85).messages({
    'number.min': 'Quality must be at least 1',
    'number.max': 'Quality cannot exceed 100',
  }),
  waitFor: Joi.number().integer().min(0).max(10000).default(0).messages({
    'number.max': 'waitFor cannot exceed 10000ms',
  }),
  darkMode: Joi.boolean().default(false),
});

module.exports = { screenshotSchema };
