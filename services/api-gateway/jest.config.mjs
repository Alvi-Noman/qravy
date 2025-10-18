import basePreset from '@qravy/config/jest-preset';

export default {
  ...basePreset,

  testEnvironment: 'node',

  // ESM + TypeScript via ts-jest (no extra tsconfig needed)
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true
      }
    ]
  },

  // Only run tests from src; never collect compiled files in dist
  roots: ['<rootDir>/src'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx|js)',
    '<rootDir>/src/**/*.(test|spec).(ts|tsx|js)'
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],

  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Allow ESM-style ".js" specifiers in TS (ts-jest will resolve the TS source)
    '^(\\.{1,2}/.*)\\.js$': '$1'
  }
};