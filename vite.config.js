import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Относительные пути к ассетам: сайт работает и в корне домена,
  // и в подпапке GitHub Pages (https://<user>.github.io/<repo>/)
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
})
