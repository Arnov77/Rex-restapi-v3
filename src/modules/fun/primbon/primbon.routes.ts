import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  WetonQuery, WetonResponse,
  JodohQuery, JodohResponse,
  ArtiNamaQuery, ArtiNamaResponse,
  ShioQuery, ShioResponse,
} from './primbon.schemas.js';
import { hitungWeton, hitungJodoh, artiNama, hitungShio } from './primbon.service.js';

const primbonRoutes: FastifyPluginAsyncZod = async (app) => {
  const limit = app.rateLimit({
    prefix: 'primbon',
    windowSec: 60,
    max: 60,
    keyGenerator: (req) => req.apiKey?.id ?? req.ip,
    message: 'Too many primbon requests',
  });

  app.get('/weton', {
    preHandler: [limit],
    schema: {
      tags: ['fun'],
      summary: 'Hitung Weton (hari + pasaran Jawa)',
      querystring: WetonQuery,
      response: { 200: WetonResponse },
    },
  }, async (req) => hitungWeton(req.query));

  app.get('/jodoh', {
    preHandler: [limit],
    schema: {
      tags: ['fun'],
      summary: 'Cek kecocokan jodoh berdasarkan nama (Primbon Jawa)',
      querystring: JodohQuery,
      response: { 200: JodohResponse },
    },
  }, async (req) => hitungJodoh(req.query));

  app.get('/arti-nama', {
    preHandler: [limit],
    schema: {
      tags: ['fun'],
      summary: 'Cari arti nama + sifat + keberuntungan',
      querystring: ArtiNamaQuery,
      response: { 200: ArtiNamaResponse },
    },
  }, async (req) => artiNama(req.query));

  app.get('/shio', {
    preHandler: [limit],
    schema: {
      tags: ['fun'],
      summary: 'Cek shio berdasarkan tahun lahir',
      querystring: ShioQuery,
      response: { 200: ShioResponse },
    },
  }, async (req) => hitungShio(req.query));
};

export default primbonRoutes;