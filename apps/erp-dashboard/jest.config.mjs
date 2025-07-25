import { fileURLToPath } from 'node:url';
import path from 'node:path';
import basePreset from '@muvance/config/jest-preset';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const config = {
  ...basePreset,
  testEnvironment: 'jest-environment-jsdom',
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