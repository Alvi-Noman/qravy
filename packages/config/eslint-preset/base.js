import tsEslintParser from '@typescript-eslint/parser';
import tsEslintPlugin from '@typescript-eslint/eslint-plugin';

export default [
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      parser: tsEslintParser,
    },
    plugins: {
      '@typescript-eslint': tsEslintPlugin,
    },
    rules: {
      'no-console': 'warn',
      ...tsEslintPlugin.configs.recommended.rules,
    },
  },
];