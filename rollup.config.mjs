import path from 'node:path';
import fs from 'node:fs';

import { rimraf } from 'rimraf';
import resolve from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import dts from 'rollup-plugin-dts';

export default async (_commandLineArgs) => {
  const libPath = import.meta.dirname;

  await rimraf(path.join(libPath, 'dist'));
  return [
    {
      input: path.join(libPath, 'src', 'index.ts'),
      output: [
        {
          file: path.join(libPath, 'dist', 'index.mjs'),
          format: 'esm', // ES module output
          sourcemap: true,
        },
      ],
      plugins: [
        typescript({ tsconfig: './tsconfig.json' }),
        resolve(),
        json(),
        commonjs(),
        replace(replaceOpts(libPath)),
        void terser(),
      ].filter(Boolean),
      external: [/^@ktjs\//, /^@babel\//],
    },
    {
      input: path.join(libPath, 'src', 'index.ts'),
      output: [{ file: path.join(libPath, 'dist', 'index.d.ts'), format: 'es' }],
      plugins: [dts({ tsconfig: './tsconfig.json' })],
      external: [/^@ktjs/],
    },
  ];
};

// #region replace options

export const globalDefines = {};

export function replaceOpts(packagePath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf-8'));
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
    preventAssignment: true,
    delimiters: ['', ''],
    values: {
      __IS_DEV__: 'false',
      __NAME__,
      __KEBAB_NAME__,
      __PKG_INFO__,
      __VERSION__,

      // global flags
      ...globalDefines,

      // global error/warn/debug
      "$throw('": `throw new Error('[${__NAME__} error] `,
      '$throw(`': `throw new Error(\`[${__NAME__} error] `,
      '$throw("': `throw new Error("[${__NAME__} error] `,
      '$warn(': `console.warn('[${__NAME__} warn]',`,
      '$error(': `console.error('[${__NAME__} error]',`,
      '$debug(': `console.debug('[${__NAME__} debug]',`,
    },
  };
}
// #endregion
