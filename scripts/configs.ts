import path from 'node:path';
import fs from 'node:fs';

import type { RollupReplaceOptions } from '@rollup/plugin-replace';

export const getTSConfig = () => {
  const tsconfigBuildPath = path.join(import.meta.dirname, '..', 'tsconfig.build.json');
  const tsconfigPath = path.join(import.meta.dirname, '..', 'tsconfig.json');
  return fs.existsSync(tsconfigBuildPath) ? tsconfigBuildPath : tsconfigPath;
};

// #region replace options

interface CommonPackageJson {
  name: string;
  version: string;
  description: string;
  description_zh: string;
  author: {
    name: string;
    email: string;
  };
  license: string;
  repository: {
    type: string;
    url: string;
  };
}

export function replaceOpts(): RollupReplaceOptions {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf-8'),
  ) as CommonPackageJson;
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
