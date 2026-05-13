const Joi = require('joi');

/**
 * YouTube service validation schemas
 */

const downloadMp3Schema = Joi.object({
  query: Joi.string().min(1).max(200).required().trim().messages({
    'string.empty': 'Search query cannot be empty',
    'any.required': 'query parameter is required',
    'string.max': 'Query too long (max 200 chars)',
  }),
});

// Resolution filter for MP4 downloads. "best" picks the highest available
// quality. A numeric value is treated as a height ceiling — the helper picks
// the highest format whose height <= requested so unsupported resolutions
// gracefully degrade instead of failing.
const MP4_QUALITIES = ['144', '240', '360', '480', '720', '1080', '1440', '2160', 'best'];

const downloadMp4Schema = Joi.object({
  query: Joi.string().min(1).max(200).required().trim(),
  quality: Joi.alternatives()
    .try(
      Joi.string().valid(...MP4_QUALITIES),
      Joi.number()
        .integer()
        .valid(...MP4_QUALITIES.filter((q) => q !== 'best').map(Number))
    )
    .default('best')
    .messages({
      'any.only': `quality must be one of: ${MP4_QUALITIES.join(', ')}`,
    }),
});

module.exports = {
  downloadMp3Schema,
  downloadMp4Schema,
  MP4_QUALITIES,
};
