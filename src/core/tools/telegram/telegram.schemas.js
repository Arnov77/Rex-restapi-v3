const Joi = require('joi');

const VALID_FORMATS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'wa'];

const stickerSchema = Joi.object({
  fileId: Joi.string()
    .trim()
    .when('url', {
      is: Joi.exist(),
      then: Joi.optional(),
      otherwise: Joi.required(),
    })
    .messages({
      'any.required': 'Sediakan fileId (Telegram file_id) atau url stiker.',
    }),

  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .trim()
    .optional()
    .messages({
      'string.uri': 'url harus berupa URL yang valid (http/https).',
    }),

  botToken: Joi.string().trim().optional().messages({
    'string.base': 'botToken harus berupa string.',
  }),

  format: Joi.string()
    .valid(...VALID_FORMATS)
    .default('png')
    .insensitive()
    .messages({
      'any.only': `Format tidak valid. Pilih: ${VALID_FORMATS.join(', ')}`,
    }),
})
  .or('fileId', 'url')
  .messages({
    'object.missing': 'Sediakan fileId atau url.',
  });

const stickerPackSchema = Joi.object({
  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .trim()
    .optional()
    .messages({
      'string.uri': 'url harus berupa URL yang valid (http/https).',
    }),
  packName: Joi.string().trim().optional().messages({
    'string.base': 'packName harus berupa string.',
  }),
  botToken: Joi.string().trim().optional(),
})
  .or('url', 'packName')
  .messages({
    'object.missing': 'Sediakan url atau packName.',
  });

// WhatsApp sticker packs cap at 30 stickers per pack (plus a tray icon).
// Larger Telegram sets auto-split; clients accept 1..30 explicitly.
// `publisher` becomes the title.txt watermark suffix; `author` is the
// author.txt content (free-form credit string).
const stickerPackDownloadSchema = Joi.object({
  url: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .trim()
    .optional(),
  packName: Joi.string().trim().optional(),
  botToken: Joi.string().trim().optional(),
  publisher: Joi.string().trim().max(80).default('Rex API'),
  author: Joi.string().trim().max(120).default('Converted via Rex REST API'),
  stickersPerPack: Joi.number().integer().min(1).max(30).default(30),
})
  .or('url', 'packName')
  .messages({ 'object.missing': 'Sediakan url atau packName.' });

module.exports = { stickerSchema, stickerPackSchema, stickerPackDownloadSchema };
