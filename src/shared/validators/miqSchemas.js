const Joi = require('joi');

const miqSchemas = {
  generateQuote: Joi.object({
    text: Joi.string()
      .required()
      .trim()
      .min(5)
      .max(500)
      .messages({
        'string.empty': 'Quote text is required',
        'string.min': 'Quote text must be at least 5 characters',
        'string.max': 'Quote text must not exceed 500 characters',
      }),
    author: Joi.string()
      .optional()
      .trim()
      .max(100)
      .default('Unknown')
      .messages({
        'string.max': 'Author name must not exceed 100 characters',
      }),
    color: Joi.boolean()
      .optional()
      .default(false)
      .messages({
        'boolean.base': 'Color must be true or false',
      }),
  }).required(),
};

module.exports = miqSchemas;
