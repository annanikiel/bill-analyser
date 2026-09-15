import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `base` must match the GitHub Pages path. A project site is served from
 * /<repo>/, so assets need that prefix; a custom domain or user site is served
 * from /. Set VITE_BASE at build time to override.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/bill-analyser/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
