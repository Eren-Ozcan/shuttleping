import js from '@eslint/js'
import globals from 'globals'

export default [
  js.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // CLI betikleri: terminale yazmak arayüzün kendisi, Pino burada yanlış araç.
    // (Kural uygulama kodu için var — orada structured log zorunlu.)
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Tarayıcı istemcileri: sürücü sayfası ve panel kaynağı
    files: ['public/**/*.js'],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'public/admin/'],
  },
]
