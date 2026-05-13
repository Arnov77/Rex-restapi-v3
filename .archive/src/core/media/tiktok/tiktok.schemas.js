const Joi = require('joi');

/**
 * TikTok service validation schemas
 */

const downloadTiktokSchema = Joi.object({
  url: Joi.string().uri().required().messages({
    'string.uri': 'Must be a valid URL',
    'any.required': 'URL parameter is required',
  }),
});

const downloadTiktokMp3Schema = Joi.object({
  url: Joi.string().uri().required(),
});

module.exports = {
  downloadTiktokSchema,
  downloadTiktokMp3Schema,
};
