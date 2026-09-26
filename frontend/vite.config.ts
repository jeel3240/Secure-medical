/// <reference types="vitest" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the browser talks only to Vite on :5173, which forwards /api
// to the API container on :3000. Same origin as far as the browser is
// concerned, so the SameSite=Strict session cookie works exactly as it will
// behind Caddy in production.
export default defineConfig({
  plugins: [react()],
  // Tests cover the logic a bug hides in - the polling hook's race guard, the
  // age and tier formatting - rather than every button. A screen is easy to
  // judge by eye; a dropped response is not.
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000' },
    },
  },
});
