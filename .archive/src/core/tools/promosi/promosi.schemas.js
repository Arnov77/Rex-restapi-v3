const Joi = require('joi');

const analyzePromosiSchema = Joi.object({
  text: Joi.string().trim().min(1).max(5000).required().messages({
    'string.empty': "Parameter 'text' diperlukan",
    'any.required': "Parameter 'text' diperlukan",
    'string.max': 'text too long (max 5000 chars)',
  }),
  threshold: Joi.number().integer().min(0).max(100).default(70),
});

module.exports = { analyzePromosiSchema };
