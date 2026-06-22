import { defineConfig } from 'vite';
import path from 'node:path';
import dts from 'unplugin-dts/vite';
import pkg from './package.json';

function getReplaceOpts(isDev: boolean) {
  function formatDateFull(dt = new Date()) {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    const ss = String(dt.getSeconds()).padStart(2, '0');
    const ms = String(dt.getMilliseconds()).padStart(3, '0');
    return `${y}.${m}.${d} ${hh}:${mm}:${ss}.${ms}`;
  }

  const __KEBAB_NAME__ = pkg.name.replace('rollup-plugin-', '');
  const __VERSION__ = pkg.version;
  const __NAME__ = __KEBAB_NAME__.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

  const __PKG_INFO__ = `## About
 * @package ${__NAME__}
 * @author ${pkg.author.name} <${pkg.author.email}>
 * @version ${pkg.version} (Last Update: ${formatDateFull()})
 * @license ${pkg.license}
 * @link ${pkg.repository.url}
 * @link https://baendlorel.github.io/ Welcome to my site!
 * @description ${pkg.description.replace(/\n/g, '\n * \n * ')}
 * @copyright Copyright (c) ${new Date().getFullYear()} ${pkg.author.name}. All rights reserved.`;

  return {
    __IS_DEV__: isDev,
    __NAME__,
    __KEBAB_NAME__,
    __PKG_INFO__,
    __VERSION__,

    // global flags
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"',

    // global error/warn/debug
    "$throw('": `throw new Error('[${__NAME__} error] `,
    '$throw(`': `throw new Error(\`[${__NAME__} error] `,
    '$throw("': `throw new Error("[${__NAME__} error] `,
    '$warn(': `console.warn('[${__NAME__} warn]',`,
    '$error(': `console.error('[${__NAME__} error]',`,
    '$debug(': `console.debug('[${__NAME__} debug]',`,
  };
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';

  return {
    plugins: [
      dts({
        tsconfigPath: './tsconfig.build.json',
      }),
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
      rollupOptions: {
        external: [/^node:/],
        output: {
          globals: {},
        },
      },
    },
    define: getReplaceOpts(isDev),
  };
});
