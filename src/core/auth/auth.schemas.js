const Joi = require('joi');

const registerSchema = Joi.object({
  username: Joi.string()
    .pattern(/^[a-zA-Z0-9_]{3,32}$/)
    .required()
    .messages({
      'string.pattern.base': 'Username must be 3-32 chars, letters / digits / underscore only',
    }),
  email: Joi.string().email().max(254).required(),
  password: Joi.string().min(8).max(200).required().messages({
    'string.min': 'Password must be at least 8 characters',
  }),
});

const loginSchema = Joi.object({
  identifier: Joi.string().min(3).max(254).required().messages({
    'any.required': 'identifier (email or username) is required',
  }),
  password: Joi.string().min(1).max(200).required(),
});

module.exports = { registerSchema, loginSchema };
