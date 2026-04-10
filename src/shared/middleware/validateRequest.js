const { ValidationError } = require('../utils/errors');

/**
 * Request Validation Middleware using Joi
 * Validates request body or query against a schema
 * 
 * @param {Object} schema - Joi schema
 * @param {string} source - 'body' or 'query' (default: 'body')
 */
const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = source === 'body' ? req.body : req.query;
    
    const { value, error } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const messages = error.details
        .map(detail => detail.message)
        .join(', ');
      return next(new ValidationError(messages));
    }

    req.validated = value;
    next();
  };
};

module.exports = validateRequest;
