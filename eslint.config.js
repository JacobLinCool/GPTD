import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-tsc', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['scripts/**/*.{js,mjs}', 'tests/**/*.ts', '*.{js,mjs,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
