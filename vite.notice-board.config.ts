import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
// The fixture imports real components, while keeping unrelated Kepler dependency
// optimization out of this focused notification gate. App build remains separate.
export default defineConfig({plugins:[react()],cacheDir:'node_modules/.vite-notices',optimizeDeps:{entries:['tests/browser/fixtures/notice-board.html','tests/browser/fixtures/ticket-notifications.html']}});
