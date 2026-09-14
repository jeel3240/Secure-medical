import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the browser talks only to Vite on :5173, which forwards /api
// to the API container on :3000. Same origin as far as the browser is
// concerned, so the SameSite=Strict session cookie works exactly as it will
// behind Caddy in production.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000' },
    },
  },
});
