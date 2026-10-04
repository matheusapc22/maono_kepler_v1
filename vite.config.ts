import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  // Preserve the larger Node heap configured in package.json, but let
  // Rollup/Vite determine the module graph. The package-by-package
  // manualChunks strategy from PR #27 could complete the build while creating
  // a broken runtime dependency order before the login route mounted.
  build: {
    target: "es2020",
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2500,
    commonjsOptions: { transformMixedEsModules: true },
  },
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ["kepler.gl", "react-audio-voice-recorder"],
  },
  resolve: {
    alias: [
      // Kepler's CJS dependency otherwise selects Parquet's CJS wrapper,
      // whose default-import interop skips WASM initialization in browsers.
      // Use the same installed native loader through its supported ESM build.
      { find: /^@loaders\.gl\/parquet$/, replacement: path.resolve(__dirname, "node_modules/@loaders.gl/parquet/dist/index.js") },
      // Kepler validates Arrow tables with instanceof. Parquet and the native
      // processors must share one constructor rather than ESM/CJS duplicates.
      { find: /^apache-arrow$/, replacement: path.resolve(__dirname, "node_modules/apache-arrow/Arrow.dom.mjs") },
      { find: "react-audio-voice-recorder", replacement: path.resolve(
        __dirname,
        "node_modules/react-audio-voice-recorder/dist/react-audio-voice-recorder.es.js",
      ) },
    ],
  },
});
