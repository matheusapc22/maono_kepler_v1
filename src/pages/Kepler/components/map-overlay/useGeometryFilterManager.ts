import { useLayoutEffect } from "react";
import { useDispatch, useSelector, useStore } from "react-redux";

import {
  setEditorMode,
  setSelectedFeature,
  toggleEditorVisibility,
  toggleMapControl,
  wrapTo,
} from "@kepler.gl/actions";
import { EDITOR_MODES } from "@kepler.gl/constants";

import {
  KEPLER_MAP_ID,
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
    state.mapDrawActive ? 1 : 0,
  ].join(":");
}

/**
 * Mantém o Editor do Kepler rigorosamente fora da experiência Maõno.
 *
 * O Polygon Filter continua existindo no Redux do Kepler apenas como engine
 * espacial. Desenho, seleção, handles, cursor, tooltip de edição e menu de
 * contexto não podem permanecer ativos. Features legadas do Editor são
 * preservadas no estado: ficam invisíveis, mas não são apagadas, evitando
 * perda silenciosa de conteúdo histórico do projeto.
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

  if (state.editorVisible) {
    dispatch(wrapTo(KEPLER_MAP_ID, toggleEditorVisibility()));
    changed = true;
  }

  return changed;
}

/**
 * Guard de isolamento, sem listeners de clique, requestAnimationFrame ou
 * manipulação do DOM. useLayoutEffect aplica a correção de estado antes do
 * paint do browser sempre que o Kepler tenta reativar qualquer parte do
 * Editor, evitando até o frame intermediário com handles/tooltips nativos.
 */
export function useGeometryFilterManager({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const dispatch = useDispatch();
  const store = useStore();
  const revision = useSelector(isolationKey);

  useLayoutEffect(() => {
    if (!enabled) return;

    // Ler o estado fresco torna o uso seguro caso outro guard tenha acabado de
    // aplicar uma transição idempotente (especialmente toggleEditorVisibility).
    enforceGeometryFilterEngineIsolation(
      (action) => dispatch(action as any),
      store.getState(),
    );
  }, [dispatch, enabled, revision, store]);
}
