import React from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { createStore } from "redux";
import { MemoryRouter, Route, Routes } from "react-router";
import { MapPanelContextProvider } from "../../../src/pages/Kepler/map-panel/MapPanelContext";
import MaonoSaveButton from "../../../src/pages/Kepler/components/maono-save-button";

const initial = { visState: { datasets: {}, layers: [], filters: [] }, mapState: { zoom: 1 }, mapStyle: {}, uiState: { currentModal: "save" }, savedConfig: { version: "v1", config: { label: "clicked" }, datasets: [] } };
const store = createStore((state = { demo: { keplerGl: { map: initial } } }, action: any) => {
  const map = state.demo.keplerGl.map;
  if (action.type === "UI_ONLY") return { demo: { keplerGl: { map: { ...map, uiState: { currentModal: null } } } } };
  if (action.type === "EDIT") return { demo: { keplerGl: { map: { ...map, visState: { ...map.visState, layers: [{ id: "later" }] }, savedConfig: { ...map.savedConfig, config: { label: "later edit" } } } } } };
  return state;
});
(globalThis as any).__durableFixtureStore = store;
const runtime = {
  state: { status: "ready", context: null, error: null },
  context: { version: 7, mode: "editor", project: { id: 12, slug: "demo", configRevision: 7 }, organization: { id: 9 }, capabilities: { saveMap: true }, allowed: true },
  refresh: () => { throw new Error("Saving must never refresh/remount the map."); },
  customLayerPanelEnabled: false, customMapShellEnabled: false, customMapOverlayEnabled: false,
};
createRoot(document.getElementById("root")!).render(<Provider store={store}><MemoryRouter initialEntries={["/projects/demo/edit"]}><Routes><Route path="/projects/:projectSlug/edit" element={<MapPanelContextProvider value={runtime as any}><button onClick={() => store.dispatch({ type: "UI_ONLY" })}>Close unrelated modal</button><button onClick={() => store.dispatch({ type: "EDIT" })}>Edit after Save</button><MaonoSaveButton /></MapPanelContextProvider>} /></Routes></MemoryRouter></Provider>);
