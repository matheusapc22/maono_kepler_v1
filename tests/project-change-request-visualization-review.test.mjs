import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const reviewPage = await readFile(
  new URL(
    "../src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

const workflow = await readFile(
  new URL(
    "../src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Review nomeia visualizações persistentes em linguagem de produto", () => {
  assert.match(reviewPage, /Alterar visibilidade/);
  assert.match(reviewPage, /Alterar filtro/);
  assert.match(reviewPage, /Reordenar camadas/);
});

test("Drawer nomeia visualizações persistentes sem expor contratos técnicos", () => {
  assert.match(workflow, /Alterar visibilidade/);
  assert.match(workflow, /Alterar filtro/);
  assert.match(workflow, /Reordenar camadas/);
});
