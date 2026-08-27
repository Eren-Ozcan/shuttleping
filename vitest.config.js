import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
    // Test veritabanına yönlendirme ve dry-run zorlaması; env modülü
    // yüklenmeden önce çalışmalı
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.js'],
      exclude: ['src/db/migrations/**'],
    },
  },
})
