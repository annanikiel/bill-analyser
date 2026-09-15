import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only source tests. Without this, vitest also picks up the compiled copies
    // under dist/ and every test appears to run twice.
    include: ['src/**/*.test.ts'],
  },
});
