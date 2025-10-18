import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharedPreset from '@qravy/config/eslint-preset';
import pluginReact from 'eslint-plugin-react';
import pluginReactHooks from 'eslint-plugin-react-hooks';
import tsEslintParser from '@typescript-eslint/parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  ...sharedPreset,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsEslintParser,
      parserOptions: {
        project: path.resolve(__dirname, './tsconfig.json'),
        tsconfigRootDir: __dirname,
        ecmaVersion: 2021,
        sourceType: 'module',
      },
    },
    plugins: {
      react: pluginReact,
      'react-hooks': pluginReactHooks,
    },
  },
  {
    files: ['**/*.{js,jsx,cjs,mjs}', '*.config.js', '*.config.ts'],
    languageOptions: {
      parser: tsEslintParser,
      parserOptions: {
        ecmaVersion: 2021,
        sourceType: 'module',
        project: null,
      },
    },
    rules: {
      'no-console': 'warn',
    },
  },
];