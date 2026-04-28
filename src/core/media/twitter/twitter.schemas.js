const Joi = require('joi');

const downloadTwitterSchema = Joi.object({
  url: Joi.string()
    .uri()
    .pattern(/(twitter\.com|x\.com|t\.co)\/.+/i)
    .required()
    .messages({
      'string.uri': 'Must be a valid URL',
      'string.pattern.base': 'URL must point to twitter.com, x.com, or t.co',
      'any.required': 'URL parameter is required',
    }),
});

module.exports = { downloadTwitterSchema };
