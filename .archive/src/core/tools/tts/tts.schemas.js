const Joi = require('joi');

const googleTtsSchema = Joi.object({
  text: Joi.string().min(1).max(5000).required().messages({
    'string.min': 'Text cannot be empty',
    'string.max': 'Text must be 5000 characters or fewer',
    'any.required': 'Text parameter is required',
  }),
  lang: Joi.string()
    .pattern(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .default('id')
    .messages({
      'string.pattern.base': 'Lang must be a BCP-47 / ISO-639 code (e.g. id, en, en-US, ja)',
    }),
  slow: Joi.boolean().default(false),
});

module.exports = { googleTtsSchema };
