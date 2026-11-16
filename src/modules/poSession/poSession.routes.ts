import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getPoSession, poSessionJson } from './poSession.service.js';

/**
 * Endpoint session server untuk cobalt. Cobalt mengeset
 * `YOUTUBE_SESSION_SERVER=http://localhost:<port aplikasi>/` lalu
 * memanggil `POST /get_pot` (pathname diganti total oleh cobalt, jadi
 * route ini HARUS di root, tanpa prefix).
 *
 * Disembunyikan dari swagger: ini infrastruktur internal, bukan API publik.
 * Tanpa auth/rate-limit/quota — cobalt tidak mengirim kredensial apa pun,
 * dan responsnya hanya membaca cache sesi (murah).
 */

const SessionResponse = z.object({
  poToken: z.string(),
  potoken: z.string(),
  visitor_data: z.string(),
  contentBinding: z.string(),
  updated: z.number(),
});

const poSessionRoutes: FastifyPluginAsyncZod = async (app) => {
  const log = {
    info: (msg: string) => app.log.info(msg),
    warn: (msg: string) => app.log.warn(msg),
  };
  const serve = async (_req: FastifyRequest, reply: FastifyReply) => {
    const session = await getPoSession(log);
    if (!session) {
      return reply.code(503).send('Token has not yet been generated, try again later.');
    }
    return poSessionJson(session);
  };

  const schema = { hide: true, response: { 200: SessionResponse, 503: z.string() } };
  app.post('/get_pot', { schema }, serve);
  app.get('/get_pot', { schema }, serve);

  // Hasilkan sesi pertama di latar belakang supaya poll pertama cobalt cepat.
  void getPoSession(log).catch(() => {
    // Tetap jalan; sesi dibuat lagi saat ada request.
  });
};

export default poSessionRoutes;
