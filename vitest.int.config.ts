import { mergeConfig, defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, defineConfig({
    test: {
        include: ['tests/integration/**/*.{test,spec}.{ts,tsx}'],
        testTimeout: 30000,
        env: {
            VITEST_USE_REAL_DB: '1',
        },
        environment: 'jsdom',
        setupFiles: ['./tests/setup.ts'],
    },
}));

