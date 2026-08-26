import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { TiktokStalkQuery, TiktokStalkResponse } from './tiktokStalk.schemas.js';
import { stalkTiktok } from './tiktokStalk.service.js';

const tiktokStalkRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'tiktok-stalk',
    windowSec: 60,
    max: 8,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many TikTok stalk requests, try again shortly.',
  });

  app.get('/', {
    preHandler: [limit],
    schema: {
      tags: ['stalk'],
      summary: "Look up a public TikTok profile's bio, follower count, and stats.",
      querystring: TiktokStalkQuery,
      response: { 200: TiktokStalkResponse },
    },
  }, async (req) => stalkTiktok(req.query.username));
};

export default tiktokStalkRoutes;