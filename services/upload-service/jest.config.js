import basePreset from '@qravy/config/jest-preset';

export default {
  ...basePreset,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^\\./routes/authRoutes\\.js$': '<rootDir>/src/routes/authRoutes.ts',
    '^\\.{2}/controllers/authController\\.js$': '<rootDir>/src/controllers/authController.ts',
    '^\\.{2}/server\\.js$': '<rootDir>/src/server.ts',
    '^\\./app\\.js$': '<rootDir>/src/app.ts',
  },
};