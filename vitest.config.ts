import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // Test files share one database, so they run one after another.
    fileParallelism: false,
    testTimeout: 15000,
  },
});
