import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Static multi-page site: `/` (home) and `/donate/`. `base: './'` keeps every
// link relative, so the build works from any host or sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  // `@` points at the dashboard's source so the landing page reuses its UI primitives and tokens.
  resolve: { alias: { '@': path.resolve(__dirname, '../web/src'), '@shared': path.resolve(__dirname, '../shared') } },
  server: { host: '127.0.0.1', port: 5174 },
  preview: { host: '127.0.0.1', port: 4174 },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        donate: path.resolve(__dirname, 'donate/index.html'),
      },
    },
  },
});
