import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Enforce best practices
      'no-console': 'off',
      'no-debugger': 'warn',
      'no-alert': 'warn',
      'no-var': 'error',
      'prefer-const': 'warn',
      'prefer-arrow-callback': 'off',
      'prefer-template': 'off',

      // Prevent common mistakes
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        ignoreRestSiblings: true,
        caughtErrorsIgnorePattern: '^_'
      }],
      'no-duplicate-imports': 'warn',
      'no-self-compare': 'error',

      // Code quality
      'eqeqeq': ['warn', 'always', { null: 'ignore' }],
      'no-throw-literal': 'warn',
      'prefer-promise-reject-errors': 'warn',
      'require-await': 'off',

      // Next.js specific
      '@next/next/no-html-link-for-pages': 'warn',
      '@next/next/no-img-element': 'warn',

      // Temporarily downgrade to warnings for merged code cleanup
      // TODO: Fix these errors and re-enable as errors
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/no-unescaped-entities': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    plugins: {
      security,
    },
    rules: {
      ...security.configs.recommended.rules,
    },
  },
  // Global ignores merged from .eslintignore and defaults
  globalIgnores([
    "**/node_modules/**",
    ".next/**",
    ".next-pre-push/**",
    "out/**",
    "build/**",
    "dist/**",
    "*.generated.*",
    "next-env.d.ts",
    "*.config.js",
    "*.config.mjs",
    "*.config.ts",
    "prisma/generated/**",
    "scripts/**",
    "coverage/**",
    "reports/**",
    "*.log",
    "public/**"
  ]),
]);

export default eslintConfig;
