const Joi = require('joi');

const revealKeySchema = Joi.object({
  password: Joi.string().min(1).max(200).required().messages({
    'any.required': 'Password diperlukan untuk reveal key',
  }),
});

module.exports = { revealKeySchema };
