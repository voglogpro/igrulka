import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'archive/**', 'play/**', 'artifacts/**', 'node_modules/**'] },
  {
    files: ['src/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/rendering/**/*.js', 'src/ui/**/*.js', 'src/audio/**/*.js', 'src/main.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/game/**/*.js'],
    languageOptions: { globals: { structuredClone: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
];
