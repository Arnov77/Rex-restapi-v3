// ESLint v9 flat config. Intentionally minimal — we lean on TypeScript
// for correctness and prettier for style; ESLint just catches the
// remaining footguns the compiler can't (unused vars, etc.).
//
// Why no full @typescript-eslint preset: turning on type-aware rules
// requires `parserOptions.project`, which slows lint by an order of
// magnitude and would re-do work `npm run typecheck` already does in CI.

import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.archive/**',
      'public/**',
      'coverage/**',
    ],
  },
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        // Node globals used in src/* and tests/*.
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        globalThis: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // Catch unused imports/vars — leading-underscore is conventional
      // for "intentionally unused" so we exempt it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // Some test files type as `any` for fixture flexibility — that's ok,
      // but keep the warning so we notice when production code does it.
      '@typescript-eslint/no-explicit-any': 'off',
      // We use `void promise` to deliberately fire-and-forget; allow it.
      'no-void': 'off',
      // Prefer const for immutable bindings — common bugfinder.
      'prefer-const': 'error',
      // Empty catch blocks are usually a smell; force at least a comment.
      'no-empty': ['error', { allowEmptyCatch: false }],
    },
  },
  {
    // Tests are allowed a few liberties: any-typed fixtures, console use,
    // and undefined globals come from vitest ambient types.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
];
