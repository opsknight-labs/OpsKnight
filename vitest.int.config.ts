import { mergeConfig, defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, defineConfig({
    test: {
        include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
        testTimeout: 30000,
        // Database reset/seed hooks truncate every table; on loaded CI hosts that can exceed the 10s default.
        hookTimeout: 60000,
        env: {
            VITEST_USE_REAL_DB: '1',
        },
        // Database tests run in Node so Prisma's Uint8Array/Buffer checks share one realm.
        // Component-rendering suites opt into jsdom per file.
        environment: 'node',
        setupFiles: ['./tests/setup.ts'],
    },
}));

