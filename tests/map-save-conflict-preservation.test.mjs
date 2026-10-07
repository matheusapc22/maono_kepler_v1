import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { confirmationMatchesEditor, executePreparedProjectUpdate } from "../src/pages/Kepler/durable-save-controller.ts";
import { memoryStore, snapshot, status, published } from "./helpers/durable-save-browser-fixtures.mjs";
const component = await readFile(new URL("../src/pages/Kepler/components/maono-save-button.tsx", import.meta.url), "utf8");
const adapter = await readFile(new URL("../src/pages/Kepler/engine-adapter/KeplerEngineAdapterProvider.tsx", import.meta.url), "utf8");
test("late local edits and reload editor generations are never marked clean by old receipt", async () => {
  const value = await snapshot();
  assert.equal(confirmationMatchesEditor(value, "editor-one", 2), true);
  assert.equal(confirmationMatchesEditor(value, "editor-one", 3), false);
  assert.equal(confirmationMatchesEditor(value, "editor-two", 2), false);
  await executePreparedProjectUpdate({ snapshot: value, store: memoryStore(), fetchImpl: async () => published(value) });
  assert.equal(confirmationMatchesEditor(value, "editor-one", 3), false);
});
test("conflict and forbidden responses keep bytes, base revision, and live draft separate", async () => {
  for (const reply of [status("CONFLICT"), new Response(JSON.stringify({ ok: false }), { status: 403 })]) {
    const value = await snapshot(); const store = memoryStore(); const draft = { editedAfterClick: true };
    await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => reply }));
    assert.deepEqual(draft, { editedAfterClick: true }); assert.equal((await store.get(value.key)).expectedConfigRevision, 7); assert.ok((await store.get(value.key)).serialized.body);
  }
});
test("save UI cannot refresh/remount the map after success, conflict or permission failure", () => {
  assert.doesNotMatch(component, /\brefresh\s*\(/);
  assert.match(component, /if \(matches\) expectedRevisionRef\.current/);
  assert.match(component, /confirmationMatchesEditor\(snapshot, editorSessionId\.current, editGeneration\.current\)/);
  assert.match(component, /currentRevision === revision/);
  assert.match(component, /Exportar rascunho atual/); assert.match(component, /Exportar tentativa/);
});
test("engine clean status is generation guarded for both normal and analysis saves", () => {
  assert.match(adapter, /detail\?\.snapshotMatchesCurrent === true\) markClean\(\)/);
  assert.match(adapter, /result\.snapshotMatchesCurrent === true\) markClean\(\)/);
});

test("reviewed terminal snapshot may be archived without erasing bytes or rebasing a new save", async () => {
  const { archiveReviewedSaveSnapshot, isPendingSaveSnapshot } = await import("../src/pages/Kepler/durable-save-store.ts");
  const value = await snapshot(); const store = memoryStore();
  await assert.rejects(executePreparedProjectUpdate({ snapshot: value, store, fetchImpl: async () => status("CONFLICT") }));
  const conflicted = await store.get(value.key); await archiveReviewedSaveSnapshot(store, conflicted);
  const archived = await store.get(value.key); assert.equal(isPendingSaveSnapshot(archived), false); assert.ok(archived.serialized.body); assert.equal(archived.expectedConfigRevision, 7);
  const newSave = await snapshot({ expectedConfigRevision: 9, editorSessionId: "after-intentional-reload" });
  assert.notEqual(newSave.manifest.operationId, archived.manifest.operationId); assert.equal(newSave.expectedConfigRevision, 9); assert.equal(isPendingSaveSnapshot(newSave), true);
  assert.match(component, /Arquivar tentativa revisada e liberar novos salvamentos/);
});

test("modal close, add-data/sidebar UI and map canvas size do not advance edit generation", async () => {
  const { createSaveEditGeneration } = await import("../src/pages/Kepler/save-edit-generation.ts");
  const initial = { visState: { datasets: {}, layers: [], filters: [] }, mapState: { longitude: 1, latitude: 2, zoom: 3, width: 100 }, mapStyle: { styleType: "dark" }, uiState: { currentModal: "save", activeSidePanel: "layer", mapControls: { mapLegend: { active: true, settings: { position: "top" } } } } };
  const observer = createSaveEditGeneration(initial);
  const uiOnly = { ...initial, mapState: { ...initial.mapState, width: 200 }, uiState: { ...initial.uiState, currentModal: null, activeSidePanel: "addData", notifications: ["done"], exportImage: { imageDataUri: "data:image/png;base64,test" } } };
  assert.equal(observer.observe(uiOnly), 0);
  const value = await snapshot({ editGeneration: 0 });
  assert.equal(confirmationMatchesEditor(value, "editor-one", observer.generation), true, "modal-close receipt may advance the next expected revision");
  assert.equal(observer.observe({ ...uiOnly, visState: { ...uiOnly.visState, layers: [{ color: "edited" }] } }), 1);
  assert.equal(confirmationMatchesEditor(value, "editor-one", observer.generation), false);
  assert.equal(observer.observeExtensionChange(), 2);
});
