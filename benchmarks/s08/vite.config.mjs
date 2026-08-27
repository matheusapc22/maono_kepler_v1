import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function resolveGitCommit() {
  if (String(process.env.GITHUB_SHA || "").trim()) {
    return String(process.env.GITHUB_SHA).trim();
  }

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

const gitCommit = resolveGitCommit();

export default defineConfig({
  root: process.cwd(),
  plugins: [react()],
  define: {
    "import.meta.env.VITE_GIT_COMMIT": JSON.stringify(gitCommit),
  },
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
