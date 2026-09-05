import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [reviewPage, workflow] = await Promise.all([
  readFile(new URL("../src/pages/Kepler/change-requests/ChangeRequestReviewPage.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/pages/Kepler/change-requests/PointFromPinWorkflow.tsx", import.meta.url), "utf8"),
]);

test("Review e drawer apresentam visualizações persistentes em linguagem de produto", () => {
  for (const label of ["Alterar visibilidade", "Alterar filtro", "Reordenar camadas"]) {
    assert.match(reviewPage, new RegExp(label));
    assert.match(workflow, new RegExp(label));
  }
  assert.match(reviewPage, /beforeLabel/);
  assert.match(reviewPage, /afterLabel/);
});
