import { useEffect } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";

import {
  setEditorMode,
  setFeatures,
  setSelectedFeature,
  toggleEditorVisibility,
  toggleMapControl,
  wrapTo,
} from "@kepler.gl/actions";
import { EDITOR_MODES } from "@kepler.gl/constants";

import {
  KEPLER_MAP_ID,
  collectionToArray,
  readValue,
  selectKeplerMapState,
  selectKeplerUiState,
  selectKeplerVisState,
} from "../../engine-adapter/selectors";

type GeometryFilterIsolationState = {
  mapAvailable: boolean;
  editorVisible: boolean;
  editorMode: string;
  selectedFeature: boolean;
  editorFeatureCount: number;
  mapDrawActive: boolean;
};

function geometryFilterIsolationState(
  rootState: unknown,
): GeometryFilterIsolationState {
  const visState = selectKeplerVisState(rootState);
  const uiState = selectKeplerUiState(rootState);
  const editor = readValue(visState, "editor");
  const mapControls = readValue(uiState, "mapControls");
  const mapDraw = readValue(mapControls, "mapDraw");

  return {
    mapAvailable: Boolean(selectKeplerMapState(rootState) && visState),
    editorVisible: Boolean(editor && readValue(editor, "visible") !== false),
    editorMode: String(readValue(editor, "mode") ?? ""),
    selectedFeature: Boolean(readValue(editor, "selectedFeature")),
    editorFeatureCount: collectionToArray(
      readValue(editor, "features"),
    ).length,
    mapDrawActive: readValue(mapDraw, "active") === true,
  };
}

function isolationKey(rootState: unknown) {
  const state = geometryFilterIsolationState(rootState);
  return [
    state.mapAvailable ? 1 : 0,
    state.editorVisible ? 1 : 0,
    state.editorMode,
    state.selectedFeature ? 1 : 0,
    state.editorFeatureCount,
    state.mapDrawActive ? 1 : 0,
  ].join(":");
}

/**
 * Mantém o Editor do Kepler rigorosamente fora da experiência Maõno.
 *
 * O Polygon Filter continua existindo no Redux do Kepler apenas como engine
 * espacial. Desenho, seleção, handles, cursor, tooltip de edição e menu de
 * contexto não podem permanecer ativos. Cada condição é lida novamente do
 * store imediatamente antes do dispatch; isso torna a função idempotente até
 * se houver mais de uma instância do guard durante uma transição de runtime.
 */
export function enforceGeometryFilterEngineIsolation(
  dispatch: (action: unknown) => unknown,
  rootState: unknown,
) {
  const state = geometryFilterIsolationState(rootState);
  if (!state.mapAvailable) return false;

  let changed = false;

  if (state.mapDrawActive) {
    dispatch(wrapTo(KEPLER_MAP_ID, toggleMapControl("mapDraw", 0)));
    changed = true;
  }

  if (state.editorMode && state.editorMode !== EDITOR_MODES.EDIT) {
    dispatch(wrapTo(KEPLER_MAP_ID, setEditorMode(EDITOR_MODES.EDIT)));
    changed = true;
  }

  if (state.selectedFeature) {
    dispatch(wrapTo(KEPLER_MAP_ID, setSelectedFeature(null)));
    changed = true;
  }

  if (state.editorFeatureCount > 0) {
    dispatch(wrapTo(KEPLER_MAP_ID, setFeatures([])));
    changed = true;
  }

  if (state.editorVisible) {
    dispatch(wrapTo(KEPLER_MAP_ID, toggleEditorVisibility()))
    changed = true;
  }

  return changed;
}

/**
 * Guard de isolamento, sem listeners de clique, requestAnimationFrame ou
 * manipulação do DOM. A reação ocorre ao estado Redux do próprio Kepler, então
 * não existe uma janela visual em que os handles azuis ou as mensagens
 * "Drag to move..." precisem aparecer para depois serem apagados.
 */
export function useGeometryFilterManager({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const dispatch = useDispatch();
  const store = useStore();
  const revision = useSelector(isolationKey);

  useEffect(() => {
    if (!enabled) return;

    // Ler o estado fresco torna o uso seguro caso outro guard tenha acabado de
    // aplicar uma transição idempotente (especialmente toggleEditorVisibility).
    enforceGeometryFilterEngineIsolation(
      (action) => dispatch(action as any),
      store.getState(),
    );
  }, [dispatch, enabled, revision, store]);
}
