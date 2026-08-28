import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The build output goes to the backend's public/admin directory; Fastify
// serves it statically. In dev, /api requests are proxied to the backend.
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
