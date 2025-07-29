import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharedPreset from './packages/config/eslint-preset/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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