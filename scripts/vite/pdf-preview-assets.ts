import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/** Only PDF.js's public decoder/font resources, never document bytes. */
export function pdfPreviewAssets(): Plugin {
  const prefix = "assets/pdfjs-6.4.299/";
  const root = path.resolve("node_modules/pdfjs-dist");
  const assets = new Map<string, string>([[prefix + "LICENSE", path.join(root, "LICENSE")]]);
  for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
    for (const name of readdirSync(path.join(root, folder))) {
      if (/^LICENSE/.test(name) || /\.(bcmap|pfb|ttf|icc)$/.test(name) || ["openjpeg.wasm", "jbig2.wasm", "qcms_bg.wasm"].includes(name) || ["openjpeg_nowasm_fallback.js", "jbig2_nowasm_fallback.js"].includes(name)) assets.set(prefix + folder + "/" + name, path.join(root, folder, name));
    }
  }
  return {
    name: "maono-pdf-preview-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = assets.get((request.url || "").split("?")[0].replace(/^\//, ""));
        if (!source) { next(); return; }
        response.setHeader("Content-Type", source.endsWith(".wasm") ? "application/wasm" : source.endsWith(".js") ? "text/javascript" : "application/octet-stream");
        response.end(readFileSync(source));
      });
    },
    generateBundle() {
      for (const [fileName, source] of assets) this.emitFile({ type: "asset", fileName, source: readFileSync(source) });
    },
  };
}
