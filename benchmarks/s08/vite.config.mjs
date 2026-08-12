import path from "node:path";
import process from "node:process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: process.cwd(),
  plugins: [react()],
  build: {
    outDir: ".benchmark-data/s08-build",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: path.resolve(process.cwd(), "benchmarks/s08/index.html"),
    },
  },
});
