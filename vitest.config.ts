import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig(() => {
  const packageDir = import.meta.dirname;
  return {
    test: {
      include: [path.join(packageDir, '**', '*.{test,spec,e2e-spec}.?(c|m)[jt]s?(x)')],
      exclude: [
        path.join(packageDir, '**', 'node_modules', '**'),
        path.join(packageDir, '**', 'dist', '**'),
        path.join(packageDir, '**', 'build', '**'),
        path.join(packageDir, '**', 'coverage', '**'),
      ],
      silent: false,
    },
    define: {},
    resolve: {
      alias: {
        '@': path.join(packageDir, 'src'),
      },
    },
  };
});
