import { defineConfig, mergeConfig } from 'vitest/config';
import integration from './vitest.int.config';

const config = mergeConfig(
  integration,
  defineConfig({
    test: {
      include: ['tests/evals/squire/**/*.test.ts'],
      fileParallelism: false,
      testTimeout: 120_000,
    },
  })
);
// mergeConfig concatenates include arrays; this suite must never discover unrelated DB tests.
config.test!.include = ['tests/evals/squire/**/*.test.ts'];
config.test!.exclude = ['**/node_modules/**'];
export default config;
