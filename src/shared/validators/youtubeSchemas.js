const Joi = require('joi');

/**
 * YouTube service validation schemas
 */

const downloadMp3Schema = Joi.object({
  query: Joi.string()
    .min(1)
    .max(200)
    .required()
    .trim()
    .messages({
      'string.empty': 'Search query cannot be empty',
      'any.required': 'query parameter is required',
      'string.max': 'Query too long (max 200 chars)',
    }),
});

const downloadMp4Schema = Joi.object({
  query: Joi.string()
    .min(1)
    .max(200)
    .required()
    .trim(),
});

module.exports = {
  downloadMp3Schema,
  downloadMp4Schema,
};
