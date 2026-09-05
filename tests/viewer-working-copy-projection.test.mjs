import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [runtime, workflow, pointCommand, reviewPage, reviewApi] = await Promise.all([
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/ViewerWorkingCopyRuntime.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/engine-adapter/usePointDatasetCommand.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/pages/Kepler/change-requests/review-api.ts",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("Viewer materializa point.create targetMode=new com IDs temporários estáveis", () => {
  assert.match(runtime, /targetMode\)\.toLowerCase\(\) === "new"/);
  assert.match(runtime, /targetDataId/);
  assert.match(runtime, /targetLayerId/);
  assert.match(runtime, /createNew:\s*!knownDataIds\.has\(dataId\)/);
  assert.match(pointCommand, /explicitDataId/);
  assert.match(pointCommand, /explicitLayerId/);
  assert.match(pointCommand, /input\.tempId/);
  assert.match(pointCommand, /return \{\s*ok: true,\s*changed: false/s);
});

test("camada temporária projetada não vira target existente de outro point.create", () => {
  assert.match(workflow, /layer\.id\.startsWith\("tmp_layer_"\)/);
  assert.match(workflow, /dataId\?\.startsWith\("tmp_data_"\)/);
  assert.match(workflow, /\+ Nova camada de pontos/);
});

test("Viewer captura estilo na Working Copy e drawer descreve a operação", () => {
  assert.match(runtime, /diffViewerLayerStyle/);
  assert.match(runtime, /upsertLayerStyleOperation/);
  assert.match(runtime, /markClean/);
  assert.match(workflow, /layer\.style\.update/);
  assert.match(workflow, /Alterar estilo/);
  assert.match(workflow, /Cor fixa alterada/);
});

test("submit não faz silent return para mutação sem contrato", () => {
  assert.match(
    workflow,
    /Existe uma alteração no mapa que ainda não pôde ser convertida em solicitação/,
  );
  assert.match(workflow, /setSubmitError/);
  assert.match(workflow, /window\.location\.reload\(\)/);
});

test("Review aceita style projection nullable e mostra Antes/Depois", () => {
  assert.match(reviewApi, /"point\.create" \| "layer\.style\.update"/);
  assert.match(reviewApi, /focus:[\s\S]*\| null/);
  assert.match(reviewApi, /overlay:[\s\S]*\| null/);
  assert.match(reviewPage, /Alterar estilo/);
  assert.match(reviewPage, /Antes:/);
  assert.match(reviewPage, /Depois:/);
  assert.match(reviewPage, /applyReviewStyleSnapshot/);
  assert.match(reviewPage, /if \(!operation\?\.focus\) return/);
});
