import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/setup.ts'],
    include: [
      'src/**/*.test.{ts,tsx,js,jsx}',
      'src/**/*.spec.{ts,tsx,js,jsx}',
    ],
    exclude: ['src/tests/msw/**', 'node_modules/**', 'dist/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});