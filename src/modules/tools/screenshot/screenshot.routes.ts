import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { screenshotService } from './screenshot.service.js';
import { ScreenshotQuery } from './screenshot.schemas.js';

const screenshotRoutes: FastifyPluginAsyncZod = async (app) => {
  // Daily quota first (cheap short-circuit), then per-minute rate-limit.
  // Master keys bypass the quota check entirely.
  const quota = app.quota({ message: 'Daily screenshot quota exceeded' });

  // Screenshot is heavy (one Chromium tab per call) — keep buckets tight.
  // Anonymous IPs share a small budget; authenticated keys get more.
  const limit = app.rateLimit({
    prefix: 'screenshot',
    windowSec: 60,
    max: 5,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many screenshot requests',
  });

  app.get(
    '/',
    {
      preHandler: [quota, limit],
      schema: {
        tags: ['tools'],
        summary: 'Capture a screenshot of a public URL.',
        description: 'Supports full-page capture and dark mode.',
        querystring: ScreenshotQuery,
        // No `response` schema: fastify-type-provider-zod expects Zod here,
        // and binary image bytes don't fit a Zod shape.
      },
    },
    async (req, reply) => {
      // Create an AbortSignal tied to client disconnect. If the user
      // closes the modal or navigates away mid-render, this fires and
      // the page pool abandons the Chromium work early — saving CPU.
      const ac = new AbortController();
      req.raw.once('close', () => ac.abort());

      const result = await screenshotService.capture(req.query, { signal: ac.signal });
      const ext = result.format === 'jpeg' ? 'jpg' : result.format;
      return reply
        .header('content-type', result.mimeType)
        .header('content-length', String(result.buffer.length))
        .header('content-disposition', `inline; filename="screenshot.${ext}"`)
        .send(result.buffer);
    },
  );
};

export default screenshotRoutes;
