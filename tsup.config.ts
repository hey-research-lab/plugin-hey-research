import { defineConfig } from 'tsup';

/**
 * ESM library bundle with type declarations. `@elizaos/core` (a peer, ESM-only, imported for types
 * only) and `@hey-research-lab/sdk` stay external.
 */
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm'],
  target: 'es2022',
  platform: 'node',
  dts: true,
  sourcemap: false,
  clean: true,
  splitting: false,
  external: ['@elizaos/core', '@hey-research-lab/sdk'],
});
