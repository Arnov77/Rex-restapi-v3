const Joi = require('joi');

const gdriveQuerySchema = Joi.object({
  url: Joi.string()
    .trim()
    .uri({ scheme: ['http', 'https'] })
    .required()
    .messages({
      'string.empty': "Parameter 'url' diperlukan",
      'any.required': "Parameter 'url' diperlukan",
      'string.uri': "Parameter 'url' harus berupa URL yang valid (http/https)",
    }),
});

module.exports = { gdriveQuerySchema };
