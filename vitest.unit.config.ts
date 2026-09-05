import { mergeConfig, defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default mergeConfig(baseConfig, defineConfig({
    test: {
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    globals: true,
                    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
                    exclude: [
                        'tests/integration/**',
                        'tests/e2e/**',
                        'node_modules/**',
                        'dist/**',
                        '.next/**',
                        'tests/hooks/**',
                        'tests/lib/auth-cache-purge.test.ts',
                    ],
                    setupFiles: ['./tests/setup.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'dom',
                    environment: 'jsdom',
                    globals: true,
                    include: [
                        'src/**/*.{test,spec}.tsx',
                        'tests/**/*.{test,spec}.tsx',
                        'tests/hooks/**/*.{test,spec}.ts',
                        'tests/lib/auth-cache-purge.test.ts',
                    ],
                    exclude: ['tests/integration/**', 'tests/e2e/**', 'node_modules/**', 'dist/**', '.next/**'],
                    setupFiles: ['./tests/setup.ts'],
                },
            },
        ],
    },
}));
