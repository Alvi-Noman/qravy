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
    ignores: ['dist/**', 'build/**', 'coverage/**', '**/*.d.ts'],
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
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'warn',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react/no-unescaped-entities': 'off',
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
  {
    files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
];