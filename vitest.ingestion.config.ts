import { defineConfig } from 'vitest/config';
import path from 'node:path';

// No shared setup: these tests intentionally exercise real PostgreSQL transactions.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/ingestion/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
    },
  },
});
