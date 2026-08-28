import { useCallback, useEffect, useReducer } from "react";

import {
  createInitialMapToolState,
  isMapToolStateValid,
  mapToolReducer,
  type BufferInsertionMode,
  type BufferToolSession,
  type MapAnalysisTool,
  type MapToolPoint,
  type MapToolPreview,
  type MapToolState,
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

export function mapToolConfigurationTarget(
  state: MapToolState,
): "buffer" | "isochrone" | null {
  if (!isMapToolStateValid(state) || state.mode !== "configuring") {
    return null;
  }

  if (state.tool === "buffer" || state.tool === "isochrone") {
    return state.tool;
  }

  return null;
}

export function useMapToolController({
  startPlacement,
  cancelPlacement,
  resetMarker,
}: {
  startPlacement: (tool: MapAnalysisTool) => void;
  cancelPlacement: () => void;
  resetMarker: () => void;
}) {
  const [state, dispatch] = useReducer(
    mapToolReducer,
    createInitialMapToolState(),
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
    startPlacement(nextState.tool);
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
    startPlacement("marker");
    return true;
  }, [startPlacement, state]);

  const pointPlaced = useCallback(
    (point: MapToolPoint): MapAnalysisTool | null => {
      if (state.mode !== "placingPoint") return null;

      const action = { type: "POINT_PLACED" as const, point };
      const nextState = mapToolReducer(state, action);
      if (
        nextState === state ||
        nextState.mode !== "configuring" ||
        !isMapToolStateValid(nextState)
      ) {
        return null;
      }

      dispatch(action);

      if (nextState.tool === "marker") {
        dispatch({ type: "ANALYSIS_CREATED" });
      }

      return nextState.tool;
    },
    [state],
  );

  const cancelPendingPoint = useCallback(() => {
    if (state.mode !== "configuring") return false;

    const action = { type: "CANCEL_PENDING_POINT" as const };
    const nextState = mapToolReducer(state, action);
    if (nextState === state) return false;

    dispatch(action);
    resetMarker();

    if (nextState.mode === "placingPoint") {
      startPlacement(nextState.tool);
    } else {
      cancelPlacement();
    }

    return true;
  }, [cancelPlacement, resetMarker, startPlacement, state]);

  const submitConfiguration = useCallback(() => {
    if (state.mode !== "configuring") return false;
    dispatch({ type: "SUBMIT_CONFIGURATION" });
    return true;
  }, [state.mode]);

  const analysisCreated = useCallback(
    (preview: MapToolPreview) => {
      if (state.mode !== "configuring") return false;
      const action = { type: "ANALYSIS_CREATED" as const, preview };
      const nextState = mapToolReducer(state, action);
      if (nextState === state || nextState.mode !== "reviewing") return false;
      dispatch(action);
      return true;
    },
    [state],
  );

  const finishAnalysis = useCallback(() => {
    cancelPlacement();
    resetMarker();
    dispatch({ type: "RESET" });
  }, [cancelPlacement, resetMarker]);

  const handlePlacementEscape = useCallback(() => {
    if (state.mode !== "placingPoint") return false;
    cancelTool();
    return true;
  }, [cancelTool, state.mode]);

  useEffect(() => {
    if (state.mode !== "placingPoint") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      handlePlacementEscape();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePlacementEscape, state.mode]);

  return {
    state,
    active: state.mode !== "idle",
    menuOpen: state.mode === "selectingTool",
    configurationTarget: mapToolConfigurationTarget(state),
    pendingPoint:
      state.mode === "configuring" || state.mode === "reviewing"
        ? state.pendingPoint
        : null,
    toggleToolMenu,
    cancelTool,
    selectTool,
    selectBufferMode,
    startSelectedPlacement,
    startMarkerPlacement,
    pointPlaced,
    cancelPendingPoint,
    submitConfiguration,
    analysisCreated,
    finishAnalysis,
    handlePlacementEscape,
  };
}
