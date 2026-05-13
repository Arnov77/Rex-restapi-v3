const { ValidationError } = require('../utils/errors');

/**
 * Request Validation Middleware using Joi
 * Validates request body, query, or params against a schema
 *
 * @param {Object} schema - Joi schema
 * @param {string} source - 'body', 'query', or 'params' (default: 'body')
 */
const validateRequest = (schema, source = 'body') => {
  return (req, res, next) => {
    const sources = {
      body: req.body,
      query: req.query,
      params: req.params,
    };
    const data = sources[source] || req.body;

    const { value, error } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const messages = error.details.map((detail) => detail.message).join(', ');
      return next(new ValidationError(messages));
    }

    if (source === 'params') req.validatedParams = value;
    else req.validated = value;
    next();
  };
};

module.exports = validateRequest;
