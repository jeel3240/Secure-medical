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
    // Vitest replaces CSS with an empty string unless told otherwise, `?raw`
    // imports included. The type-system test reads the stylesheets as text,
    // so it needs the files in src/styles for real; nothing else is processed.
    css: { include: [/src\/styles\/[\w-]+\.css/] },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // 127.0.0.1, not localhost. Docker publishes the API on IPv4 only, and
      // `localhost` is tried as IPv6 first - so when anything else on the
      // machine listens on [::1]:3000 (another project's dev server did,
      // 2026-10-11), every /api call went to it and sign-in failed here with
      // nothing wrong in this app.
      '/api': { target: 'http://127.0.0.1:3000' },
    },
  },
});
