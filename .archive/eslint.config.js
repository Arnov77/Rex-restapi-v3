const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'downloads/**',
      'logs/**',
      'temp/**',
      'public/**',
      'src/shared/logs/**',
      '**/*-player-script.js',
      'coverage/**',
      'dist/**',
      'build/**',
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      // Pragmatic defaults for an existing codebase — prefer warnings over errors
      // so cleanup can be incremental. Tighten to 'error' once the codebase is
      // clean.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_|^next$|^err$',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_|^e$',
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-prototype-builtins': 'warn',

      // Control characters are intentional in filename-sanitization regexes.
      'no-control-regex': 'off',
      // Downgraded: existing switch/case blocks without braces are harmless
      // here; will be tightened module-by-module.
      'no-case-declarations': 'warn',

      // Style/formatting is delegated to Prettier — this line disables conflicts
      // via eslint-config-prettier (applied as a config object below).
    },
  },
  {
    // Files that contain Playwright `page.evaluate()` callbacks reference
    // browser globals (window/document). Those callbacks are serialized and
    // run in Chromium, not Node.js — so allow these globals for such files.
    files: [
      'src/core/tools/telegram/telegram.service.js',
      'src/core/media/brat/**/*.js',
      'src/core/tools/quote/**/*.js',
    ],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
  prettierConfig,
];
