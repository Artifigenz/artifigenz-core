import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  // Bundle workspace packages so the production build is self-contained
  // and doesn't rely on the monorepo structure at runtime.
  noExternal: [/^@artifigenz\//],
  // Don't generate .d.ts (we don't ship types from this package)
  dts: false,
  // Clean output dir on each build
  clean: true,
});
