import type { MapAnalysisKind } from "../engine-adapter/types.ts";

export const MAONO_MAP_SAVE_REQUEST_EVENT = "maono:save-map";
export const MAONO_MAP_SAVE_RESULT_EVENT = "maono:map-save-result";

export type MapSaveRequestSource =
  | "isochrone-preview"
  | "buffer-preview";
export type MapSaveResultStatus = "success" | "error" | "cancelled";

export type MapSaveRequestDetail = {
  requestId: string;
  source: MapSaveRequestSource;
  dataId: string;
};

export type MapSaveResultDetail = MapSaveRequestDetail & {
  status: MapSaveResultStatus;
  message: string | null;
};

function normalizedText(value: unknown, maximumLength = 200) {
  const text = typeof value === "string" ? value.trim() : "";

  return text && text.length <= maximumLength ? text : null;
}

function normalizedSource(value: unknown): MapSaveRequestSource | null {
  return value === "isochrone-preview" || value === "buffer-preview"
    ? value
    : null;
}

export function mapSaveSourceAnalysisKind(
  source: MapSaveRequestSource,
): MapAnalysisKind {
  return source === "buffer-preview" ? "buffer" : "isochrone";
}

function requestId() {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `map-save:${crypto.randomUUID()}`;
  }

  return `map-save:${Date.now()}:${Math.random()
    .toString(36)
    .slice(2)}`;
}

export function dispatchMapSaveRequest(
  input: Omit<MapSaveRequestDetail, "requestId">,
) {
  const detail: MapSaveRequestDetail = {
    requestId: requestId(),
    source: input.source,
    dataId: input.dataId,
  };

  window.dispatchEvent(
    new CustomEvent<MapSaveRequestDetail>(
      MAONO_MAP_SAVE_REQUEST_EVENT,
      { detail },
    ),
  );

  return detail;
}

export function mapSaveRequestFromEvent(
  event: Event,
): MapSaveRequestDetail | null {
  const detail = (event as CustomEvent<unknown>).detail;

  if (!detail || typeof detail !== "object") return null;

  const request = detail as Partial<MapSaveRequestDetail>;
  const normalizedRequestId = normalizedText(request.requestId);
  const dataId = normalizedText(request.dataId);
  const source = normalizedSource(request.source);

  if (!normalizedRequestId || !dataId || !source) {
    return null;
  }

  return {
    requestId: normalizedRequestId,
    source,
    dataId,
  };
}

export function emitMapSaveResult(
  request: MapSaveRequestDetail,
  status: MapSaveResultStatus,
  message: string | null = null,
) {
  window.dispatchEvent(
    new CustomEvent<MapSaveResultDetail>(
      MAONO_MAP_SAVE_RESULT_EVENT,
      {
        detail: {
          ...request,
          status,
          message: normalizedText(message, 500),
        },
      },
    ),
  );
}

export function mapSaveResultFromEvent(
  event: Event,
): MapSaveResultDetail | null {
  const detail = (event as CustomEvent<unknown>).detail;

  if (!detail || typeof detail !== "object") return null;

  const result = detail as Partial<MapSaveResultDetail>;
  const normalizedRequestId = normalizedText(result.requestId);
  const dataId = normalizedText(result.dataId);
  const source = normalizedSource(result.source);
  const status =
    result.status === "success" ||
    result.status === "error" ||
    result.status === "cancelled"
      ? result.status
      : null;

  if (!normalizedRequestId || !dataId || !source || !status) {
    return null;
  }

  return {
    requestId: normalizedRequestId,
    source,
    dataId,
    status,
    message: normalizedText(result.message, 500),
  };
}
