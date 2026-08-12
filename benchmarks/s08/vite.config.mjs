import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: process.cwd(),
  plugins: [react()],
  optimizeDeps: {
    exclude: ["kepler.gl", "react-audio-voice-recorder"],
  },
  resolve: {
    alias: {
      "react-audio-voice-recorder": path.resolve(
        process.cwd(),
        "node_modules/react-audio-voice-recorder/dist/react-audio-voice-recorder.es.js",
      ),
    },
  },
  build: {
    target: "es2020",
    outDir: ".benchmark-data/s08-build",
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: false,
    chunkSizeWarningLimit: 2500,
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      input: path.resolve(process.cwd(), "benchmarks/s08/index.html"),
    },
  },
});
