const Joi = require('joi');

const generateQuoteSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required().messages({
    'string.empty': "Parameter 'name' wajib diisi",
    'any.required': "Parameter 'name' wajib diisi",
    'string.max': 'name too long (max 100 chars)',
  }),
  message: Joi.string().trim().min(1).max(1000).required().messages({
    'string.empty': "Parameter 'message' wajib diisi",
    'any.required': "Parameter 'message' wajib diisi",
    'string.max': 'message too long (max 1000 chars)',
  }),
  avatarUrl: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .optional()
    .messages({
      'string.uri': 'avatarUrl must be a valid http(s) URL',
    }),
});

module.exports = { generateQuoteSchema };
