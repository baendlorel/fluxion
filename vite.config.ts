import { defineConfig } from 'vite';
import path from 'node:path';
import fs, { rmSync } from 'node:fs';
import dts from 'unplugin-dts/vite';

function getReplaceOpts(isDev: boolean) {
  return {
    __IS_DEV__: isDev,
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',
  };
}

// Plugin to copy main d.ts file to dist root
function copyDtsPlugin() {
  return {
    name: 'copy-dts',
    writeBundle() {
      const srcDts = path.resolve(__dirname, 'dist/src/index.d.ts');
      const destDts = path.resolve(__dirname, 'dist/index.d.ts');
      if (fs.existsSync(srcDts)) {
        fs.copyFileSync(srcDts, destDts);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  rmSync('./dist', { recursive: true, force: true });

  return {
    plugins: [
      dts({
        tsconfigPath: './tsconfig.build.json',
      }),
      // copyDtsPlugin(),
    ],
    build: {
      lib: {
        entry: path.resolve(__dirname, 'src/index.ts'),
        name: 'fluxion',
        formats: ['es', 'cjs'],
        fileName: (format) => {
          return format === 'es' ? 'index.mjs' : 'index.cjs';
        },
      },
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      minify: isDev ? false : 'terser',
      target: 'node18',
      rollupOptions: {
        external: [/^node:/, 'fs', 'path', 'os', 'events', 'fs/promises', 'chokidar', 'minimatch'],
        output: {
          globals: {},
        },
      },
    },
    define: getReplaceOpts(isDev),
  };
});
