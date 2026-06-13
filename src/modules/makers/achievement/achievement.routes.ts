import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { achievementService } from './achievement.service.js';
import { AchievementQuery } from './achievement.schemas.js';

const achievementRoutes: FastifyPluginAsyncZod = async (app) => {
  const quota = app.quota({ message: 'Daily achievement quota exceeded' });

  const limit = app.rateLimit({
    prefix: 'achievement',
    windowSec: 60,
    max: 10,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many achievement requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['maker'],
        summary: 'Minecraft Achievement',
        description: 'Buat gambar achievement bergaya Minecraft.',
        querystring: AchievementQuery,
      },
    },
    async (req, reply) => {
      const before = achievementService.cache.hits;
      const result = await achievementService.generate(req.query);
      const cacheHit = achievementService.cache.hits > before;
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;

      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="achievement.${ext}"`)
        .header('cache-control', 'public, max-age=1800')
        .header('x-cache', cacheHit ? 'HIT' : 'MISS')
        .send(result.buffer);
    },
  );
};

export default achievementRoutes;
