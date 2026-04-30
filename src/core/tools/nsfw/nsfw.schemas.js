const Joi = require('joi');

const detectSchema = Joi.object({
  imageUrl: Joi.string()
    .optional()
    .trim()
    .uri()
    .custom((value, helpers) => {
      const { protocol } = new URL(value);
      if (protocol !== 'https:') {
        return helpers.error('imageUrl.https');
      }
      return value;
    })
    .messages({
      'string.uri': 'Image URL must be a valid URL',
      'imageUrl.https': 'Image URL must use HTTPS',
    }),
  threshold: Joi.number().min(0).max(1).optional(),
}).required();

module.exports = { detectSchema };
