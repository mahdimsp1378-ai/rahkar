import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGitHubPages ? '/rahkar/' : '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        customer: resolve(import.meta.dirname, 'customer.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
        support: resolve(import.meta.dirname, 'support.html'),
        sales: resolve(import.meta.dirname, 'sales.html'),
      },
    },
  },
});
