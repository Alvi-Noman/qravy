import basePreset from '@muvance/config/jest-preset';

export default {
  ...basePreset,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};