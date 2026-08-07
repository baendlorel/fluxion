import { defineConfig } from 'tsdown';
import replace from '@rollup/plugin-replace';
// @ts-expect-error
import pkg from './package.json' with { type: 'json' };

const isDev = process.env.NODE_ENV === 'development';
const plugins = () => [
  replace({
    preventAssignment: true,
    delimiters: ['', ''],
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
    __VERSION__: pkg.version,

    // global _throw
    "_throw('": `throw new Error('[fluxion error] `,
    '_throw(`': 'throw new Error(`[fluxion error] ',
    '_throw("': 'throw new Error("[fluxion error] ',
  }),
];

export default defineConfig([
  {
    entry: [{ index: 'src/index.ts' }],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: !isDev,
    target: 'node24',
    treeshake: !isDev,
    plugins: plugins(),
    deps: {
      onlyBundle: ['type-narrow', 'fast-json-stable-stringify'],
    },
  },
  // CLI 入口 — 用于 bin 命令
  {
    entry: [{ 'cli/index': 'src/cli/index.ts' }],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: false,
    minify: false,
    target: 'node24',
    treeshake: false,
    plugins: plugins(),
    deps: {
      onlyBundle: ['type-narrow', 'fast-json-stable-stringify'],
    },
  },
  // Daemon 入口 — 被 spawn 的常驻进程
  {
    entry: [{ 'cli/daemon': 'src/cli/daemon.ts' }],
    format: ['esm'],
    dts: false,
    clean: false,
    sourcemap: false,
    minify: false,
    target: 'node24',
    treeshake: false,
    plugins: plugins(),
    deps: {
      onlyBundle: ['type-narrow', 'fast-json-stable-stringify'],
    },
  },
]);
