// ESLint for the backend - added 2026-09-28 in the code-quality pass. Until
// then nothing linted the code, although files carried eslint-disable comments.
// The TypeScript compiler already rejects unused locals and parameters
// (tsconfig.json); this adds the rules the compiler cannot express.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'coverage/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      // An unused name prefixed with "_" is deliberate - an Express error
      // handler's `next`, a destructured field set aside.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Plain CommonJS - scripts/migrate.js - where require() is the module system.
    files: ['**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Scripts run by hand against a scratch database: loosely typed results
    // from ad hoc queries are fine there.
    files: ['scripts/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  }
);
