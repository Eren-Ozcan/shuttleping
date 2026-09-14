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
    // CLI scripts: writing to the terminal is the interface itself, Pino is the
    // wrong tool here. (The rule exists for application code — structured logs are required there.)
    files: ['scripts/**/*.js'],
    languageOptions: {
      // WebSocket is a Node 22 global; the shared globals list predates it
      globals: { ...globals.node, WebSocket: 'readonly' },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Browser clients: the driver page and the panel source
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
