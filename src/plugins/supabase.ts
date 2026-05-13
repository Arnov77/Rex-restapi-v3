import fp from 'fastify-plugin';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';
import { loadEnv } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    supabase: SupabaseClient;
  }
}

/**
 * Decorates the Fastify instance with a singleton Supabase service-role
 * client. Uses `ws` for the realtime transport because Node 20 lacks
 * native WebSocket — supabase-js constructs a RealtimeClient eagerly even
 * if we never use it.
 */
export default fp(
  async (app) => {
    const env = loadEnv();
    const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'public' },
      realtime: { transport: ws as never },
      global: { headers: { 'x-client-info': 'rex-api' } },
    });
    app.decorate('supabase', client);
  },
  { name: 'supabase' },
);
