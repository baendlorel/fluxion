import { defineConfig } from 'tsdown';
import replace from '@rollup/plugin-replace';

const isDev = process.env.NODE_ENV === 'development';
const plugins = () => [
  replace({
    preventAssignment: true,
    delimiters: ['', ''],
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),

    // global $throw
    "$throw('": `throw new Error('[fluxion error] `,
    '$throw(`': 'throw new Error(`[fluxion error] ',
    '$throw("': `throw new Error("[fluxion error] `,
  }),
];

export default defineConfig([
  {
    entry: ['src/index.ts'],
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
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm', 'cjs'],
    dts: false,
    clean: true,
    sourcemap: false,
    minify: !isDev,
    target: 'node24',
    exports: {
      bin: {
        fluxion: './src/cli/index.ts',
      },
    },
    treeshake: !isDev,
    plugins: plugins(),
    deps: {
      onlyBundle: ['type-narrow', 'fast-json-stable-stringify'],
    },
  },
]);
