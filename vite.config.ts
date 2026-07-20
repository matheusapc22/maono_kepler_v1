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
    alias: {
      "react-audio-voice-recorder": path.resolve(
        __dirname,
        "node_modules/react-audio-voice-recorder/dist/react-audio-voice-recorder.es.js",
      ),
    },
  },
});
