import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { ensureMasterKeyBootstrap } from './bootstrap.js';

async function main() {
  const env = loadEnv();
  const app = await buildApp({ logger: true });

  // Provision the first master key if requested. Runs after buildApp() so
  // app.supabase is available, and before listen() so a misconfigured
  // bootstrap fails the boot loudly instead of accepting traffic.
  try {
    await ensureMasterKeyBootstrap(app, env);
  } catch (err) {
    app.log.error({ err }, 'master key bootstrap failed');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    app.log.error({ err }, 'failed to start');
    process.exit(1);
  }
}

void main();