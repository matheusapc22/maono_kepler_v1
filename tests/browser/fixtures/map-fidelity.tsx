// The viewer, Maono reducer/layer classes, hydrator and serializer are real.
// Only the page, basemap and input datasets are local fixtures. No session,
// API, provider, save permission or operational acceptance is simulated here.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { Provider } from "react-redux";
import { applyMiddleware, combineReducers, createStore } from "redux";
import { enhanceReduxMiddleware } from "@kepler.gl/reducers";
import KeplerGl from "@kepler.gl/components";
import { addDataToMap, layerConfigChange, updateMap } from "@kepler.gl/actions";
import demoReducer from "../../../src/pages/Kepler/reducers";
import { hydrateSavedKeplerConfig } from "../../../src/pages/Kepler/map-url-loader/saved-config-hydrator";
import { serializeProjectConfig } from "../../../src/pages/Kepler/thumbnail/capture-thumbnail";
import { getMaonoConfigForSave, loadPointClusterState } from "../../../src/pages/Kepler/clustering/point-cluster-store";
import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";

let root: Root | undefined;
let store: any;
let deck: any;
let gl: WebGLRenderingContext | WebGL2RenderingContext;
let initialized = false;
const state = () => store.getState().demo.keplerGl.map;
const featureEnabled = import.meta.env.VITE_POINT_CLUSTERING_V1 === "true";
const styles = [{ id: "dark", label: "Local", url: `${window.location.origin}/tests/browser/fixtures/map-fidelity-style.json` }];

const api = {
  featureEnabled,
  mount(saved: any) {
    root?.unmount();
    deck = undefined;
    initialized = false;
    loadPointClusterState(undefined);
    store = createStore(combineReducers({ demo: demoReducer }), applyMiddleware(...enhanceReduxMiddleware([])));
    root = createRoot(document.getElementById("fixture-root")!);
    root.render(
      <Provider store={store}>
        <KeplerGl id="map" getState={(value: any) => value.demo.keplerGl} width={1000} height={640}
          mapboxApiAccessToken="" mapStyles={styles} mapStylesReplaceDefault readOnly
          onKeplerGlInitialized={() => {
            const loaded = hydrateSavedKeplerConfig(saved, { featureEnabled });
            store.dispatch(addDataToMap({ ...loaded, options: { centerMap: false, keepExistingConfig: false } }));
            initialized = true;
          }}
          onDeckInitialized={(value: any, context: any) => { deck = value; gl = context; }}
        />
      </Provider>,
    );
  },
  ready() { return Boolean(initialized && deck?.layerManager && gl && deck.layerManager.getLayers().every((layer: any) => layer.isLoaded)); },
  diagnostics() { return { initialized, deck: Boolean(deck), manager: Boolean(deck?.layerManager), layers: state()?.visState?.layers?.map((layer: any) => layer.id), mapStyle: state()?.mapStyle?.isLoading }; },
  serialize() {
    const saved: any = serializeProjectConfig(state());
    const maono = getMaonoConfigForSave();
    if (maono) saved.maono = maono;
    return JSON.parse(JSON.stringify(saved));
  },
  zoom(zoom: number) { store.dispatch(updateMap({ zoom })); },
  visible(isVisible: boolean) {
    for (const layer of state().visState.layers) store.dispatch(layerConfigChange(layer, { isVisible }));
  },
  async frame() {
    deck.redraw(true);
    gl.finish();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let paintedPixels = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] !== 0) paintedPixels += 1;
    const digest = await crypto.subtle.digest("SHA-256", pixels);
    return {
      hash: Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(""),
      paintedPixels,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
      renderer: gl.getParameter(gl.RENDERER),
      layers: deck.layerManager.getLayers().map((layer: any) => layer.id),
    };
  },
};
(window as any).__MAP_FIDELITY__ = api;
