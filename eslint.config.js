import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharedPreset from '@muvance/config/eslint-preset';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Root ESLint configuration.
 * - Extends shared preset from packages/config/eslint-preset
 * - Lints all TS/JS files in apps, packages, and services
 * - Ignores compiled and config files
 * - Sets parserOptions.project to all package tsconfigs for type-aware linting
 */
export default [
  ...sharedPreset,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    ignores: [
      '**/dist/**',
      '**/*.d.ts',
      '**/vite.config.ts',
      '**/jest.config.mjs',
      '**/postcss.config.js',
      '**/tailwind.config.js',
      '**/eslint.config.js',
      '**/.prettierrc.js'
    ],
    languageOptions: {
      parserOptions: {
        project: [
          './apps/*/tsconfig.json',
          './services/*/tsconfig.json',
          './packages/*/tsconfig.json'
        ],
        tsconfigRootDir: __dirname,
        ecmaVersion: 2021,
        sourceType: 'module',
      },
    },
  },
];
