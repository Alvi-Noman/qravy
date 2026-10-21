import { fileURLToPath } from 'node:url';
import path from 'node:path';
import basePreset from '@qravy/config/jest-preset';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  ...basePreset,
  testEnvironment: 'jest-environment-jsdom',
  // the app's components compiled as Vite does (React's automatic JSX, default imports) — the component tests
  // (e.g. __tests__/suggestionsManual.test.tsx) render them; types are checked by `tsc`, not here
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
        tsconfig: { jsx: 'react-jsx', esModuleInterop: true, allowSyntheticDefaultImports: true, target: 'ES2022' },
      },
    ],
  },
  roots: [path.resolve(__dirname, 'src')],
  testMatch: [
    '<rootDir>/src/**/*.test.(ts|tsx|js|jsx)',
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx|js|jsx)'
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  }
};

export default config;