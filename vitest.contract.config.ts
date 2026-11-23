import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Real PostgreSQL/PgBouncer contract suite. No shared setup: Prisma must not be mocked.
process.env.DATABASE_URL = process.env.CONTRACT_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/prisma-contract/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/mocks/server-only.ts'),
    },
  },
});
