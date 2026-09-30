import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/**/*.test.js'],
    // QuickJS uses a strict wall-clock deadline; parallel router suites contend
    // for CPU and can turn otherwise-fast executions into random timeouts.
    fileParallelism: false,
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
  },
});
