import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the same build-time flag substitution as Vite, retaining real Kepler/
// deck.gl classes. This adapter does not fake the renderer or a browser session.
const cache = new Map();
export function loadPointClusterRuntime(featureValue = "true") {
  if (!cache.has(featureValue)) cache.set(featureValue, compile(featureValue));
  return cache.get(featureValue);
}

async function compile(featureValue) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const directory = await mkdtemp(`${root}tests/.cluster-runtime-`);
  try {
    const outfile = `${directory}/runtime.mjs`;
    await build({
      stdin: {
        contents: `
          export * from "./src/pages/Kepler/clustering/point-cluster-adaptive-layer.ts";
          export * from "./src/pages/Kepler/clustering/point-cluster-store.ts";
        `,
        resolveDir: root,
      },
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      outfile,
      define: { "import.meta.env.VITE_POINT_CLUSTERING_V1": JSON.stringify(featureValue) },
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function pointRenderOptions(data, zoom = 9) {
  return {
    data: { data, getPosition: (point) => point.position, getRadius: () => 1, textLabels: [] },
    mapState: { zoom, width: 1600, height: 900 },
    gpuFilter: { filterValueUpdateTriggers: {} },
    interactionConfig: { brush: { enabled: false, config: { size: 1 } } },
    animationConfig: {},
  };
}
