import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import security from "eslint-plugin-security";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['**/*.{js,jsx,ts,tsx,mjs,mts}'],
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
  {
    files: [
      'tests/architecture/compliance-evidence-contract.test.ts',
      'tests/lib/load-certification-suite.test.ts',
    ],
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
    },
  },
  {
    files: ['tests/load/**/*.{ts,js}'],
    languageOptions: {
      globals: {
        __ENV: 'readonly',
        __VU: 'readonly',
        __ITER: 'readonly',
        open: 'readonly',
      },
    },
    rules: {
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-object-injection': 'off',
      'security/detect-child-process': 'off',
      'security/detect-non-literal-regexp': 'off',
      'security/detect-unsafe-regex': 'off',
      'import/no-anonymous-default-export': 'off',
    },
  },
  {
    // Save-feedback enterprise contract: only "@/lib/toast" + the global Toaster may touch `sonner`.
    // Prevent ad-hoc direct sonner toasts that bypass stable ids / durations / bypass-resistance.
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/lib/toast.ts', 'src/components/ui/shadcn/sonner.tsx', 'src/components/incident/IncidentAlertToast.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'sonner',
              message: 'Import notify from "@/lib/toast" instead of "sonner" directly. Direct sonner usage is reserved for src/lib/toast.ts, src/components/ui/shadcn/sonner.tsx, and IncidentAlertToast.',
            },
          ],
        },
      ],
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
    "artifacts/**",
    "*.generated.*",
    "next-env.d.ts",
    "*.config.js",
    "*.config.mjs",
    "*.config.ts",
    "prisma/generated/**",
    "scripts/**",
    "deploy/scripts/**",
    "coverage/**",
    "reports/**",
    "*.log",
    "public/**"
  ]),
]);

export default eslintConfig;
