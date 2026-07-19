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

test("Vite splits the heavy geospatial dependency families", () => {
  for (const scope of [
    "@kepler.gl",
    "@deck.gl",
    "@luma.gl",
    "@loaders.gl",
  ]) {
    assert.match(
      viteConfig,
      new RegExp(scope.replace(".", "\\.")),
      `missing manual chunk rule for ${scope}`,
    );
  }

  assert.match(viteConfig, /manualChunks/);
  assert.match(viteConfig, /reportCompressedSize:\s*false/);
  assert.match(viteConfig, /sourcemap:\s*false/);
});
