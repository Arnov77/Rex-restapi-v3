const Joi = require('joi');

const VALID_FORMATS = ['png', 'jpg', 'gif', 'webp'];

const smemeSchema = Joi.object({
  image: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      'any.required': "Parameter 'image' diperlukan (URL gambar)",
      'string.empty': "Parameter 'image' diperlukan (URL gambar)",
      'string.uri': "'image' harus berupa URL http/https yang valid",
    }),
  top: Joi.string().allow('').default(''),
  bottom: Joi.string().allow('').default(''),
  format: Joi.string()
    .lowercase()
    .valid(...VALID_FORMATS)
    .default('png'),
  width: Joi.number().integer().min(50).max(4096).optional(),
  height: Joi.number().integer().min(50).max(4096).optional(),
  font: Joi.string().trim().max(50).optional(),
  color: Joi.string().trim().max(30).optional(),
  layout: Joi.string().trim().max(30).optional(),
});

module.exports = { smemeSchema };
