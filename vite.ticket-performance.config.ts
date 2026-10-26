import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Isolated actual Central component; production profiling, not full application CI.
export default defineConfig({
  root: process.env.PERF_FIXTURE_ROOT || path.resolve(__dirname,'tests/browser/fixtures/ticket-performance'),
  build: { outDir: process.env.PERF_BUILD_OUT || path.resolve(__dirname,'dist-ticket-performance'), emptyOutDir: true },
  plugins: [react()],
  resolve: { alias: [
    { find: '@perf-src', replacement: (process.env.PERF_SOURCE_ROOT || path.resolve(__dirname,'src')).split(path.sep).join('/') },
    { find: /^react-dom\/client$/, replacement: path.resolve(__dirname,'node_modules/react-dom/profiling.js') },
    { find: /^react-dom$/, replacement: path.resolve(__dirname,'node_modules/react-dom/profiling.js') },
  ] },
});
