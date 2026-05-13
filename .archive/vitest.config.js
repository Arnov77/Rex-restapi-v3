const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js', 'src/**/*.test.js'],
    testTimeout: 10_000,
    globals: true,
    // Several auth/quota tests symlink the project's data/ dir to a per-test
    // tmpdir; running test files in parallel causes them to clobber each
    // other's symlinks. Single-threaded execution avoids that interference
    // and keeps the suite fast enough.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
