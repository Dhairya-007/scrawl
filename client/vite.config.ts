import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * GitHub Pages serves a project site from `/<repo>/`, not from the root, so
 * the base has to match or every asset 404s. It is passed in at build time
 * and defaults to `/`, which is what the single-service deploy and local
 * development both want.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // The game talks to the server on the same origin in production, so dev
    // proxies the socket instead of making the client aware of two hosts.
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/healthz': { target: 'http://localhost:3001' },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
