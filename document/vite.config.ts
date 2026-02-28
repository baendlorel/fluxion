import path from 'node:path';

import { defineConfig } from 'vite';
import ktjsx from '@ktjs/vite-plugin-ktjsx';

const rootDir = import.meta.dirname;

export default defineConfig({
  root: rootDir,
  build: {
    outDir: path.join(rootDir, 'dist'),
    emptyOutDir: true,
  },
  plugins: [ktjsx()],
  server: {
    port: 4173,
    open: true,
  },
});
