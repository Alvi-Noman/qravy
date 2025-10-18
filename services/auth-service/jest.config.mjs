// services/auth-service/jest.config.mjs
import basePreset from '@qravy/config/jest-preset';

export default {
  ...basePreset,

  testEnvironment: 'node',

  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  transform: {
    '^.+\\.(ts|tsx|js)$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          isolatedModules: true,
          module: 'ESNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          allowJs: true,
        },
      },
    ],
  },

  roots: ['<rootDir>/src'],
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.(ts|tsx|js)',
    '<rootDir>/src/**/*.(test|spec).(ts|tsx|js)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'json'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@qravy/config/validateEnv$': '<rootDir>/src/__mocks__/validateEnvMock.ts',
    '^@qravy/shared/utils/policy$': '<rootDir>/../../packages/shared/src/utils/policy.ts',
    '^@qravy/shared$': '<rootDir>/../../packages/shared/src/types/index.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },

  transformIgnorePatterns: ['/node_modules/'],
};
