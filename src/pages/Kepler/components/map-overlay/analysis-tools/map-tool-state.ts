export type MapAnalysisTool = "marker" | "buffer" | "isochrone";

export type BufferInsertionMode = "multi";

export type MapToolPoint = {
  longitude: number;
  latitude: number;
};

export type BufferPreliminaryOptions = {
  kind: "buffer";
  insertionMode: BufferInsertionMode;
};

export type MapToolPreliminaryOptions = BufferPreliminaryOptions | null;

export type BufferToolSession = {
  kind: "buffer";
  id: string;
  insertionMode: "multi";
  dataId: string | null;
};

export type MapToolSession = BufferToolSession | null;

export type MapToolPreview = {
  kind: "buffer" | "isochrone";
  dataId: string;
};

type MapToolStateBase = {
  preliminaryOptions: MapToolPreliminaryOptions;
  pendingPoint: MapToolPoint | null;
  session: MapToolSession;
};

export type IdleMapToolState = MapToolStateBase & {
  mode: "idle";
  tool: null;
  preliminaryOptions: null;
  pendingPoint: null;
  session: null;
};

export type SelectingToolMapToolState = MapToolStateBase & {
  mode: "selectingTool";
  tool: MapAnalysisTool | null;
  menu: "root" | "buffer" | "isochrone";
  pendingPoint: null;
  session: null;
};

export type PlacingPointMapToolState = MapToolStateBase & {
  mode: "placingPoint";
  tool: MapAnalysisTool;
  pendingPoint: null;
};

export type ConfiguringMapToolState = MapToolStateBase & {
  mode: "configuring";
  tool: MapAnalysisTool;
  pendingPoint: MapToolPoint;
  configurationStatus: "editing" | "submitting";
};

export type ReviewingMapToolState = MapToolStateBase & {
  mode: "reviewing";
  tool: "buffer" | "isochrone";
  pendingPoint: MapToolPoint;
  preview: MapToolPreview;
};

export type MapToolState =
  | IdleMapToolState
  | SelectingToolMapToolState
  | PlacingPointMapToolState
  | ConfiguringMapToolState
  | ReviewingMapToolState;

export type MapToolAction =
  | { type: "OPEN_TOOL_MENU" }
  | { type: "SELECT_TOOL"; tool: MapAnalysisTool }
  | {
      type: "SET_PRELIMINARY_OPTIONS";
      options: BufferPreliminaryOptions;
    }
  | { type: "START_PLACEMENT"; session?: BufferToolSession | null }
  | { type: "POINT_PLACED"; point: MapToolPoint }
  | { type: "CANCEL_PENDING_POINT" }
  | { type: "SUBMIT_CONFIGURATION" }
  | { type: "ANALYSIS_CREATED"; preview?: MapToolPreview | null }
  | { type: "CONTINUE_MULTI" }
  | { type: "FINISH_MULTI" }
  | { type: "CANCEL_TOOL" }
  | { type: "RESET" };

export const INITIAL_MAP_TOOL_STATE: IdleMapToolState = {
  mode: "idle",
  tool: null,
  preliminaryOptions: null,
  pendingPoint: null,
  session: null,
};

export function createInitialMapToolState(): IdleMapToolState {
  return { ...INITIAL_MAP_TOOL_STATE };
}

function isMapAnalysisTool(tool: unknown): tool is MapAnalysisTool {
  return tool === "marker" || tool === "buffer" || tool === "isochrone";
}

function isValidPoint(point: MapToolPoint | null): point is MapToolPoint {
  return Boolean(
    point &&
      Number.isFinite(point.longitude) &&
      Number.isFinite(point.latitude) &&
      point.longitude >= -180 &&
      point.longitude <= 180 &&
      point.latitude >= -90 &&
      point.latitude <= 90,
  );
}

function isValidBufferOptions(
  options: MapToolPreliminaryOptions,
): options is BufferPreliminaryOptions {
  return Boolean(
    options &&
      options.kind === "buffer" &&
      options.insertionMode === "multi",
  );
}

function isValidMultiBufferSession(
  session: MapToolSession,
): session is BufferToolSession {
  return Boolean(
    session &&
      session.kind === "buffer" &&
      session.insertionMode === "multi" &&
      typeof session.id === "string" &&
      session.id.trim().length > 0 &&
      (session.dataId === null ||
        (typeof session.dataId === "string" && session.dataId.trim().length > 0)),
  );
}

function toolOptionsAreCompatible(
  tool: MapAnalysisTool,
  options: MapToolPreliminaryOptions,
) {
  if (tool === "buffer") return isValidBufferOptions(options);
  return options === null;
}

function sessionIsCompatible(
  tool: MapAnalysisTool,
  options: MapToolPreliminaryOptions,
  session: MapToolSession,
) {
  if (tool !== "buffer") return session === null;
  if (!isValidBufferOptions(options)) return false;
  return isValidMultiBufferSession(session);
}

function previewIsCompatible(
  tool: ReviewingMapToolState["tool"],
  preview: MapToolPreview,
) {
  return (
    preview.kind === tool &&
    typeof preview.dataId === "string" &&
    preview.dataId.trim().length > 0
  );
}

export function isMapToolStateValid(state: MapToolState): boolean {
  switch (state.mode) {
    case "idle":
      return (
        state.tool === null &&
        state.preliminaryOptions === null &&
        state.pendingPoint === null &&
        state.session === null
      );

    case "selectingTool": {
      if (state.pendingPoint !== null || state.session !== null) return false;
      if (state.tool === null) {
        return state.menu === "root" && state.preliminaryOptions === null;
      }
      if (!isMapAnalysisTool(state.tool)) return false;
      if (state.tool === "buffer") {
        return (
          state.menu === "buffer" &&
          isValidBufferOptions(state.preliminaryOptions)
        );
      }
      if (state.tool === "isochrone") {
        return state.menu === "isochrone" && state.preliminaryOptions === null;
      }
      return state.menu === "root" && state.preliminaryOptions === null;
    }

    case "placingPoint":
      return (
        isMapAnalysisTool(state.tool) &&
        state.pendingPoint === null &&
        toolOptionsAreCompatible(state.tool, state.preliminaryOptions) &&
        sessionIsCompatible(
          state.tool,
          state.preliminaryOptions,
          state.session,
        )
      );

    case "configuring":
      return (
        isMapAnalysisTool(state.tool) &&
        isValidPoint(state.pendingPoint) &&
        (state.configurationStatus === "editing" ||
          state.configurationStatus === "submitting") &&
        toolOptionsAreCompatible(state.tool, state.preliminaryOptions) &&
        sessionIsCompatible(
          state.tool,
          state.preliminaryOptions,
          state.session,
        )
      );

    case "reviewing":
      return (
        (state.tool === "buffer" || state.tool === "isochrone") &&
        isValidPoint(state.pendingPoint) &&
        previewIsCompatible(state.tool, state.preview) &&
        toolOptionsAreCompatible(state.tool, state.preliminaryOptions) &&
        sessionIsCompatible(
          state.tool,
          state.preliminaryOptions,
          state.session,
        )
      );
  }
}

export function assertMapToolStateInvariant(state: MapToolState): MapToolState {
  if (!isMapToolStateValid(state)) {
    throw new Error(`Invalid map tool state: ${state.mode}`);
  }
  return state;
}

function nextState<T extends MapToolState>(state: T): T {
  assertMapToolStateInvariant(state);
  return state;
}

function isMultiBufferState(state: MapToolState) {
  return Boolean(
    state.tool === "buffer" &&
      isValidBufferOptions(state.preliminaryOptions) &&
      isValidMultiBufferSession(state.session),
  );
}

export function mapToolReducer(
  state: MapToolState,
  action: MapToolAction,
): MapToolState {
  assertMapToolStateInvariant(state);

  switch (action.type) {
    case "OPEN_TOOL_MENU":
      if (state.mode !== "idle") return state;
      return nextState({
        mode: "selectingTool",
        tool: null,
        menu: "root",
        preliminaryOptions: null,
        pendingPoint: null,
        session: null,
      });

    case "SELECT_TOOL":
      if (state.mode !== "selectingTool") return state;
      return nextState({
        mode: "selectingTool",
        tool: action.tool,
        menu:
          action.tool === "buffer"
            ? "buffer"
            : action.tool === "isochrone"
              ? "isochrone"
              : "root",
        preliminaryOptions:
          action.tool === "buffer"
            ? { kind: "buffer", insertionMode: "multi" }
            : null,
        pendingPoint: null,
        session: null,
      });

    case "SET_PRELIMINARY_OPTIONS":
      if (state.mode !== "selectingTool" || state.tool !== "buffer") {
        return state;
      }
      if (!isValidBufferOptions(action.options)) return state;
      return nextState({
        ...state,
        preliminaryOptions: action.options,
      });

    case "START_PLACEMENT": {
      if (state.mode !== "selectingTool" || !state.tool) return state;
      if (!toolOptionsAreCompatible(state.tool, state.preliminaryOptions)) {
        return state;
      }

      const session =
        state.tool === "buffer" && isValidBufferOptions(state.preliminaryOptions)
          ? action.session ?? null
          : null;

      if (!sessionIsCompatible(state.tool, state.preliminaryOptions, session)) {
        return state;
      }

      return nextState({
        mode: "placingPoint",
        tool: state.tool,
        preliminaryOptions: state.preliminaryOptions,
        pendingPoint: null,
        session,
      });
    }

    case "POINT_PLACED":
      if (state.mode !== "placingPoint" || !isValidPoint(action.point)) {
        return state;
      }
      return nextState({
        mode: "configuring",
        tool: state.tool,
        preliminaryOptions: state.preliminaryOptions,
        pendingPoint: action.point,
        session: state.session,
        configurationStatus: "editing",
      });

    case "CANCEL_PENDING_POINT":
      if (state.mode !== "configuring") return state;
      if (isMultiBufferState(state)) {
        return nextState({
          mode: "placingPoint",
          tool: "buffer",
          preliminaryOptions: state.preliminaryOptions,
          pendingPoint: null,
          session: state.session,
        });
      }
      return createInitialMapToolState();

    case "SUBMIT_CONFIGURATION":
      if (state.mode !== "configuring") return state;
      return nextState({
        ...state,
        configurationStatus: "submitting",
      });

    case "ANALYSIS_CREATED": {
      if (state.mode !== "configuring") return state;
      if (state.tool === "marker") return createInitialMapToolState();

      const preview = action.preview ?? null;
      if (!preview || !previewIsCompatible(state.tool, preview)) return state;

      const session =
        state.tool === "buffer" && isMultiBufferState(state) && state.session
          ? { ...state.session, dataId: preview.dataId }
          : state.session;

      return nextState({
        mode: "reviewing",
        tool: state.tool,
        preliminaryOptions: state.preliminaryOptions,
        pendingPoint: state.pendingPoint,
        session,
        preview,
      });
    }

    case "CONTINUE_MULTI":
      if (state.mode !== "reviewing" || !isMultiBufferState(state)) {
        return state;
      }
      return nextState({
        mode: "placingPoint",
        tool: "buffer",
        preliminaryOptions: state.preliminaryOptions,
        pendingPoint: null,
        session: state.session,
      });

    case "FINISH_MULTI":
      if (!isMultiBufferState(state)) return state;
      return createInitialMapToolState();

    case "CANCEL_TOOL":
    case "RESET":
      return createInitialMapToolState();
  }
}
