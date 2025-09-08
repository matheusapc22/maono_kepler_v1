import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  build: { commonjsOptions: { transformMixedEsModules: true } },
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ["kepler.gl", "react-audio-voice-recorder"],
  },
  resolve: {
    alias: {
      "react-audio-voice-recorder": path.resolve(
        __dirname,
        "node_modules/react-audio-voice-recorder/dist/react-audio-voice-recorder.es.js"
      ),
    },
  },
});
