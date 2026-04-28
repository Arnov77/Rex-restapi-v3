const Joi = require('joi');

const createKeySchema = Joi.object({
  name: Joi.string().min(1).max(80).required().messages({
    'string.empty': 'name cannot be empty',
    'any.required': 'name is required',
  }),
  tier: Joi.string().valid('user', 'master').default('user'),
});

const revokeParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createKeySchema, revokeParamsSchema };
