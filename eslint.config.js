// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.angular/**',
      '**/node_modules/**',
      'release/**',
      'bin/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['packages/admin/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'jk', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'jk', style: 'camelCase' },
      ],
    },
  },
  {
    files: ['packages/admin/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
  },
  {
    // Script di build e di rilascio: girano in Node.
    files: ['scripts/**/*.mjs', 'packages/*/build.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    // Pagina remota servita dal relay: gira nel browser (e seal.js anche nei test in Node).
    files: ['packages/relay/public/**/*.js'],
    languageOptions: {
      globals: Object.fromEntries(
        [
          'atob',
          'btoa',
          'confirm',
          'CryptoKey',
          'crypto',
          'document',
          'history',
          'indexedDB',
          'localStorage',
          'location',
          'navigator',
          'scrollTo',
          'addEventListener',
          'setTimeout',
          'clearTimeout',
          'TextDecoder',
          'TextEncoder',
          'URLSearchParams',
          'WebSocket',
        ].map((g) => [g, 'readonly']),
      ),
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
  prettier,
);
