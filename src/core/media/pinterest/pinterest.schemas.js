const Joi = require('joi');

const downloadPinterestSchema = Joi.object({
  url: Joi.string()
    .uri()
    .pattern(/(pinterest\.[a-z.]+\/(pin|amp\/pin)\/[A-Za-z0-9-]+|pin\.it\/)/i)
    .required()
    .messages({
      'string.uri': 'Must be a valid URL',
      'string.pattern.base':
        'URL must point to a Pinterest pin (pinterest.com/pin/..., pinterest.co.uk/..., or pin.it/...)',
      'any.required': 'URL parameter is required',
    }),
});

module.exports = { downloadPinterestSchema };
