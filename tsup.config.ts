import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.tsx'],
  format: ['esm'],
  target: 'node18',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['react', 'ink', '@anthropic-ai/sdk'],
  noExternal: ['chalk', 'figures', 'cli-spinners'],
  esbuildOptions(options) {
    options.jsx = 'automatic';
  },
});
