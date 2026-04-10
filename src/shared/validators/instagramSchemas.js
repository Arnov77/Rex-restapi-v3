const Joi = require('joi');

/**
 * Instagram service validation schemas
 */

const downloadInstagramSchema = Joi.object({
  url: Joi.string()
    .uri()
    .required()
    .messages({
      'string.uri': 'Must be a valid Instagram URL',
      'any.required': 'URL parameter is required',
    }),
});

module.exports = {
  downloadInstagramSchema,
};
