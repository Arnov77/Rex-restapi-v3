import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { InstagramStalkQuery, InstagramStalkResponse } from './instagramStalk.schemas.js';
import { stalkInstagram } from './instagramStalk.service.js';

const instagramStalkRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'ig-stalk',
    windowSec: 60,
    max: 15,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many Instagram stalk requests, try again shortly.',
  });

  app.get('/', {
    preHandler: [limit],
    schema: {
      tags: ['stalk'],
      summary: "Look up a public Instagram profile's bio, follower count, and stats.",
      querystring: InstagramStalkQuery,
      response: { 200: InstagramStalkResponse },
    },
  }, async (req) => stalkInstagram(req.query.username));
};

export default instagramStalkRoutes;