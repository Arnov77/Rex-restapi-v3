import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Resolve a path relative to this config file to an absolute path. */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
    reporters: 'default',
    // Run the deterministic env setup before every test file so suites that
    // don't import it explicitly (and the host's ambient env) can't break
    // the strict env schema (e.g. an uppercase LOG_LEVEL).
    setupFiles: ['./tests/setupEnv.ts'],
  },
  resolve: {
    // Mirror the tsconfig `paths` so tests resolve the same `@shared`,
    // `@modules`, and `@/` specifiers the source uses. More specific
    // aliases must come before the generic `@`.
    alias: {
      '@shared': r('./src/shared'),
      '@modules': r('./src/modules'),
      '@': r('./src'),
    },
  },
});
