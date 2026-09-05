import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [runtime, workflow, reviewPage, reviewApi, backend] = await Promise.all([
  readFile(
    new URL("../src/pages/Kepler/change-requests/ViewerWorkingCopyRuntime.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/pages/Kepler/change-requests/review-api.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../functions/_lib/project-change-request-visualization-operations.js", import.meta.url),
    "utf8",
  ),
]);

test("Viewer captura somente visualizações persistíveis previstas", () => {
  for (const operation of [
    "layer.visibility.update",
    "persistent.filter.update",
    "layer.order.update",
  ]) {
    assert.match(runtime, new RegExp(operation.replaceAll(".", "\\.")));
    assert.match(reviewApi, new RegExp(operation.replaceAll(".", "\\.")));
    assert.match(backend, new RegExp(operation.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(runtime, /updateViewport\(/);
  assert.doesNotMatch(runtime, /setTooltipEnabled\(/);
  assert.doesNotMatch(runtime, /interactionConfigChange/);
});

test("Drawer e Review usam linguagem de produto", () => {
  for (const label of ["Alterar visibilidade", "Alterar filtro", "Reordenar camadas"]) {
    assert.match(workflow, new RegExp(label));
    assert.match(reviewPage, new RegExp(label));
  }
  assert.match(reviewPage, /beforeLabel/);
  assert.match(reviewPage, /afterLabel/);
});

test("Review projeta visibilidade, filtro e ordem no mapa", () => {
  assert.match(reviewPage, /layerConfigChange\(layer, \{ isVisible: visible \}\)/);
  assert.match(reviewPage, /reorderKeplerLayer\(ids\)/);
  assert.match(reviewPage, /addKeplerFilter/);
  assert.match(reviewPage, /removeKeplerFilter/);
  assert.match(reviewPage, /setFilter\(index, "value", snapshot\.value\)/);
});
