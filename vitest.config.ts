import { defineConfig } from 'vitest/config';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '.env.test') });

// Fallback if .env.test is missing (e.g. CI or local without file)
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://opsknight:devpassword@localhost:5432/opsknight_db?schema=public';
process.env.NEXTAUTH_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'testsecret';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 20000,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'tests/',
        '**/*.config.{js,ts}',
        '**/*.d.ts',
        '**/mockData/**',
        'prisma/',
        '.next/',
      ],
      thresholds: {
        lines: 70,
        functions: 65,
        branches: 60,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/mocks/server-only.ts'),
    },
  },
});
