import { defineConfig } from 'vite';

export default defineConfig({
  root: './demo',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
  optimizeDeps: {
    exclude: ['genetic-assembly'],
  },
});
