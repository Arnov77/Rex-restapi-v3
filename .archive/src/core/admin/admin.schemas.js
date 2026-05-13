const Joi = require('joi');

const createKeySchema = Joi.object({
  name: Joi.string().min(1).max(80).required().messages({
    'string.empty': 'name cannot be empty',
    'any.required': 'name is required',
  }),
  tier: Joi.string().valid('user', 'master').default('user'),
  dailyLimit: Joi.number().integer().min(0).optional().allow(null),
});

const updateKeySchema = Joi.object({
  name: Joi.string().min(1).max(80).optional(),
  tier: Joi.string().valid('user', 'master').optional(),
  dailyLimit: Joi.number().integer().min(0).optional().allow(null),
}).min(1);

const revokeParamsSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

module.exports = { createKeySchema, updateKeySchema, revokeParamsSchema };
