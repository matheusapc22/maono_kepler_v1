import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const viteConfig = await readFile(
  new URL("../vite.config.ts", import.meta.url),
  "utf8",
);
const indexHtml = await readFile(
  new URL("../index.html", import.meta.url),
  "utf8",
);
const mainEntry = await readFile(
  new URL("../src/main.tsx", import.meta.url),
  "utf8",
);

test("Cloudflare build grants Vite a 6144 MB heap", () => {
  assert.match(
    packageJson.scripts.build,
    /vite\.js build/,
    "the production script must execute the Vite binary explicitly",
  );
  assert.match(
    packageJson.scripts.build,
    /--max-old-space-size=6144[^&]*vite\.js build/,
    "the Vite process must receive a 6144 MB heap",
  );
});

test("Vite keeps runtime-safe automatic chunk ordering", () => {
  assert.doesNotMatch(
    viteConfig,
    /manualChunks/,
    "manual package chunks can introduce circular runtime initialization",
  );
  assert.match(viteConfig, /reportCompressedSize:\s*false/);
  assert.match(viteConfig, /sourcemap:\s*false/);
  assert.match(viteConfig, /minify:\s*"esbuild"/);
});

test("application displays a visible boot state instead of a blank page", () => {
  assert.match(indexHtml, /id="app-boot-fallback"/);
  assert.match(indexHtml, /__MAONO_BOOT_TIMEOUT__/);
  assert.match(indexHtml, /__MAONO_SHOW_BOOT_FAILURE__/);
  assert.match(indexHtml, /Tentar novamente/);
  assert.match(mainEntry, /clearTimeout\(window\.__MAONO_BOOT_TIMEOUT__\)/);
  assert.match(mainEntry, /Elemento raiz da aplicação não foi encontrado/);
});
