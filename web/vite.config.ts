import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: {
      // API_URL permite apontar para outra instância da API em desenvolvimento.
      // changeOrigin: false mantém o Host do navegador (localhost:5173), usado no retorno do login do Google.
      '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false },
      '/webhooks': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: false },
    },
  },
});
