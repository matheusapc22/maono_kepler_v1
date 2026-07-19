import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

function scopedPackageChunk(
  id: string,
  scope: string,
  chunkPrefix: string,
): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  const marker = `/node_modules/${scope}/`;
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) return undefined;

  const packageStart = markerIndex + marker.length;
  const packageName = normalized.slice(packageStart).split("/")[0];
  return packageName ? `${chunkPrefix}-${packageName}` : chunkPrefix;
}

export function manualChunks(id: string): string | undefined {
  const normalized = id.replace(/\\/g, "/");
  if (!normalized.includes("/node_modules/")) return undefined;

  return (
    scopedPackageChunk(normalized, "@kepler.gl", "kepler") ||
    scopedPackageChunk(normalized, "@deck.gl", "deck") ||
    scopedPackageChunk(normalized, "@luma.gl", "luma") ||
    scopedPackageChunk(normalized, "@loaders.gl", "loaders") ||
    scopedPackageChunk(normalized, "@openassistant", "assistant") ||
    (normalized.includes("/node_modules/apache-arrow/")
      ? "data-apache-arrow"
      : undefined) ||
    (normalized.includes("/node_modules/parquet-wasm/")
      ? "data-parquet-wasm"
      : undefined) ||
    (normalized.includes("/node_modules/react/") ||
    normalized.includes("/node_modules/react-dom/") ||
    normalized.includes("/node_modules/scheduler/")
      ? "react-core"
      : undefined) ||
    (normalized.includes("/node_modules/react-redux/") ||
    normalized.includes("/node_modules/redux/") ||
    normalized.includes("/node_modules/redux-actions/") ||
    normalized.includes("/node_modules/redux-logger/") ||
    normalized.includes("/node_modules/redux-thunk/")
      ? "state-management"
      : undefined) ||
    (normalized.includes("/node_modules/react-router/") ||
    normalized.includes("/node_modules/react-router-redux/")
      ? "routing"
      : undefined) ||
    (normalized.includes("/node_modules/react-intl/") ||
    normalized.includes("/node_modules/intl-messageformat/")
      ? "internationalization"
      : undefined) ||
    (normalized.includes("/node_modules/styled-components/") ||
    normalized.includes("/node_modules/@emotion/")
      ? "styling"
      : undefined) ||
    (normalized.includes("/node_modules/dropbox/") ? "dropbox" : undefined)
  );
}

export default defineConfig({
  // Keep the Cloudflare build below the previous Rollup memory peak.
  build: {
    target: "es2020",
    sourcemap: false,
    minify: "esbuild",
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1800,
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
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
