import { useCallback, useReducer } from "react";

import {
  createInitialMapToolState,
  mapToolReducer,
  type BufferInsertionMode,
  type BufferToolSession,
  type MapAnalysisTool,
} from "./map-tool-state";

function createMultiBufferSession(): BufferToolSession {
  const randomId =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return {
    kind: "buffer",
    id: `buffer-session-${randomId}`,
    insertionMode: "multi",
    dataId: null,
  };
}

export function useMapToolController({
  startPlacement,
  cancelPlacement,
}: {
  startPlacement: () => void;
  cancelPlacement: () => void;
}) {
  const [state, dispatch] = useReducer(
    mapToolReducer,
    undefined,
    createInitialMapToolState,
  );

  const cancelTool = useCallback(() => {
    cancelPlacement();
    dispatch({ type: "CANCEL_TOOL" });
  }, [cancelPlacement]);

  const toggleToolMenu = useCallback(() => {
    if (state.mode === "idle") {
      dispatch({ type: "OPEN_TOOL_MENU" });
      return;
    }

    cancelPlacement();
    dispatch({ type: "CANCEL_TOOL" });
  }, [cancelPlacement, state.mode]);

  const selectTool = useCallback((tool: MapAnalysisTool) => {
    dispatch({ type: "SELECT_TOOL", tool });
  }, []);

  const selectBufferMode = useCallback((insertionMode: BufferInsertionMode) => {
    dispatch({
      type: "SET_PRELIMINARY_OPTIONS",
      options: {
        kind: "buffer",
        insertionMode,
      },
    });
  }, []);

  const startSelectedPlacement = useCallback(() => {
    if (state.mode !== "selectingTool" || !state.tool) return false;

    const session =
      state.tool === "buffer" &&
      state.preliminaryOptions?.kind === "buffer" &&
      state.preliminaryOptions.insertionMode === "multi"
        ? createMultiBufferSession()
        : null;
    const action = {
      type: "START_PLACEMENT" as const,
      session,
    };
    const nextState = mapToolReducer(state, action);

    if (nextState === state || nextState.mode !== "placingPoint") {
      return false;
    }

    dispatch(action);
    startPlacement();
    return true;
  }, [startPlacement, state]);

  const startMarkerPlacement = useCallback(() => {
    if (state.mode !== "selectingTool" || state.tool !== null) return false;

    const selectedState = mapToolReducer(state, {
      type: "SELECT_TOOL",
      tool: "marker",
    });
    const placementAction = { type: "START_PLACEMENT" as const };
    const placementState = mapToolReducer(selectedState, placementAction);

    if (placementState.mode !== "placingPoint") return false;

    dispatch({ type: "SELECT_TOOL", tool: "marker" });
    dispatch(placementAction);
    startPlacement();
    return true;
  }, [startPlacement, state]);

  const completeLegacyPlacement = useCallback(() => {
    dispatch({ type: "CANCEL_TOOL" });
  }, []);

  return {
    state,
    active: state.mode !== "idle",
    menuOpen: state.mode === "selectingTool",
    toggleToolMenu,
    cancelTool,
    selectTool,
    selectBufferMode,
    startSelectedPlacement,
    startMarkerPlacement,
    completeLegacyPlacement,
  };
}
