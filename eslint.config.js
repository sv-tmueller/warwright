import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

// sim/ determinism enforcement. Keep this token list in sync with the
// forbidden-token regexes in packages/core/src/determinism-scan.test.ts:
// lint gives fast feedback, the scan test is the exhaustive belt (it also
// covers sim/*.test.ts and catches escapes like globalThis.crypto).
const NON_DETERMINISTIC_MATH_PROPERTIES = [
  'sqrt',
  'cbrt',
  'pow',
  'exp',
  'expm1',
  'log',
  'log1p',
  'log2',
  'log10',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'hypot',
  'fround',
];

const FORBIDDEN_NODE_IMPORTS = [
  'fs',
  'path',
  'os',
  'crypto',
  'http',
  'https',
  'net',
  'tls',
  'dns',
  'dgram',
  'child_process',
  'worker_threads',
  'cluster',
  'perf_hooks',
  'util',
  'stream',
  'zlib',
  'readline',
  'vm',
  'inspector',
  'async_hooks',
  'events',
  'buffer',
  'process',
];

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['packages/core/src/sim/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'sim/ is deterministic: no wall-clock time.' },
        { name: 'performance', message: 'sim/ is deterministic: no wall-clock time.' },
        {
          name: 'crypto',
          message: 'sim/ is deterministic: use the seeded PRNG (mulberry32), not crypto.',
        },
        { name: 'document', message: 'sim/ has no DOM access.' },
        { name: 'window', message: 'sim/ has no DOM access.' },
        { name: 'navigator', message: 'sim/ has no DOM access.' },
        { name: 'fetch', message: 'sim/ has no network access.' },
        { name: 'XMLHttpRequest', message: 'sim/ has no network access.' },
        { name: 'WebSocket', message: 'sim/ has no network access.' },
        {
          name: 'requestAnimationFrame',
          message: 'sim/ has no renderer access; ticks drive the sim.',
        },
        { name: 'localStorage', message: 'sim/ has no browser storage access.' },
        { name: 'sessionStorage', message: 'sim/ has no browser storage access.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'sim/ is deterministic: use the seeded PRNG (mulberry32), not Math.random.',
        },
        ...NON_DETERMINISTIC_MATH_PROPERTIES.map((property) => ({
          object: 'Math',
          property,
          message: `sim/ uses integer combat math: Math.${property} is not allowed (compare squared distances instead of sqrt/hypot; no trig or logs).`,
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['node:*'], message: 'sim/ imports nothing from Node.' }],
          paths: FORBIDDEN_NODE_IMPORTS.map((name) => ({
            name,
            message: 'sim/ imports nothing from Node.',
          })),
        },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    plugins: reactHooks.configs.flat.recommended.plugins,
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@warwright/core/*', '**/core/src/**'],
              message:
                'packages/web only consumes core through its public API (bare @warwright/core); it never imports sim internals directly.',
            },
          ],
        },
      ],
    },
  },
);
