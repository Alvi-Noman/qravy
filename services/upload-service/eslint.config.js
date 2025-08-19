import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharedPreset from '@muvance/config/eslint-preset';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default [
  ...sharedPreset,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    ignores: ['dist/**'], // <--- ignore compiled files
    languageOptions: {
      parserOptions: {
        project: path.resolve(__dirname, './tsconfig.json'),
        tsconfigRootDir: __dirname,
        ecmaVersion: 2021,
        sourceType: 'module',
      },
    },
  },
];
