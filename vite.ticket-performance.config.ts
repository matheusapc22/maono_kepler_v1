import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Isolated actual Central component; production profiling, not full application CI.
export default defineConfig({
  root: path.resolve(__dirname,'tests/browser/fixtures/ticket-performance'),
  build: { outDir: path.resolve(__dirname,'dist-ticket-performance'), emptyOutDir: true },
  plugins: [react()],
  resolve: { alias: [
    { find: /^react-dom\/client$/, replacement: path.resolve(__dirname,'node_modules/react-dom/profiling.js') },
    { find: /^react-dom$/, replacement: path.resolve(__dirname,'node_modules/react-dom/profiling.js') },
  ] },
});
