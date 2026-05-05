const Joi = require('joi');

const urlField = Joi.string()
  .uri({ scheme: ['http', 'https'] })
  .max(500)
  .required()
  .messages({
    'string.uri': 'url must be a valid http(s) URL',
    'any.required': 'url is required',
  });

const resolveSchema = Joi.object({
  url: urlField,
});

const downloadSchema = Joi.object({
  url: urlField,
});

module.exports = {
  resolveSchema,
  downloadSchema,
};
