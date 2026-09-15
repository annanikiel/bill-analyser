import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'lib/**/*.test.ts'],
    // Synthesising the stack bundles five Lambdas with esbuild.
    testTimeout: 120_000,
  },
});
