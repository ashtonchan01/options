import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/yahoo-api': {
        target: 'http://localhost:3456',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/yahoo-api/, ''),
      },
    },
  },
})
