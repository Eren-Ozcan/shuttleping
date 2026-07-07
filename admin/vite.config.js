import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build çıktısı backend'in public/admin dizinine gider; Fastify static
// olarak servis eder. Dev'de /api istekleri backend'e proxy'lenir.
export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  build: {
    outDir: '../public/admin',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
