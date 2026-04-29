const Joi = require('joi');

const registerSchema = Joi.object({
  username: Joi.string()
    .pattern(/^[a-zA-Z0-9_]{3,32}$/)
    .required()
    .messages({
      'string.pattern.base': 'Username must be 3-32 chars, letters / digits / underscore only',
    }),
  email: Joi.string().email().max(254).required(),
  // At least 10 chars and must contain a letter AND a digit. The lookahead
  // regex enforces both; Joi `min` would still apply if the regex matched
  // a shorter string for some reason.
  password: Joi.string()
    .min(10)
    .max(200)
    .pattern(/^(?=.*[A-Za-z])(?=.*\d).{10,200}$/)
    .required()
    .messages({
      'string.min': 'Password minimal 10 karakter',
      'string.pattern.base': 'Password minimal 10 karakter dan harus mengandung huruf dan angka',
    }),
});

const loginSchema = Joi.object({
  identifier: Joi.string().min(3).max(254).required().messages({
    'any.required': 'identifier (email or username) is required',
  }),
  password: Joi.string().min(1).max(200).required(),
});

module.exports = { registerSchema, loginSchema };
