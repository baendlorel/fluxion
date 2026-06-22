import { defineConfig } from 'tsdown';

export default defineConfig(() => {
  return {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    target: 'node24',
    deps: {
      neverBundle: ['/^node:/*', 'chokidar', 'minimatch', 'type-narrow'],
    },
  };
});
