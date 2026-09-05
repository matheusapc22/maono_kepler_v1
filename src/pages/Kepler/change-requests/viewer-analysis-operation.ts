import type {
  ViewerAnalysisCreatePayload,
  ViewerChangeOperation,
} from "./viewer-working-copy";

export const MAONO_VIEWER_ANALYSIS_OPERATION_EVENT =
  "maono:viewer-analysis-operation";

export type ViewerAnalysisOperationType = "buffer.create" | "isochrone.create";

export type ViewerAnalysisOperationRequest = {
  type: ViewerAnalysisOperationType;
  payload: ViewerAnalysisCreatePayload;
};

export type ViewerAnalysisOperationResult = {
  ok: boolean;
  operation?: ViewerChangeOperation;
  message?: string;
};

type EventDetail = {
  request: ViewerAnalysisOperationRequest;
  respond(result: ViewerAnalysisOperationResult): void;
};

export function requestViewerAnalysisOperation(
  request: ViewerAnalysisOperationRequest,
): Promise<ViewerAnalysisOperationResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({
      ok: false,
      message: "O workspace local do Viewer não está disponível.",
    });
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ViewerAnalysisOperationResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = window.setTimeout(
      () =>
        finish({
          ok: false,
          message: "O workspace local do Viewer não respondeu.",
        }),
      5_000,
    );

    window.dispatchEvent(
      new CustomEvent<EventDetail>(MAONO_VIEWER_ANALYSIS_OPERATION_EVENT, {
        detail: { request, respond: finish },
      }),
    );
  });
}

export function isViewerAnalysisOperationEvent(
  event: Event,
): event is CustomEvent<EventDetail> {
  if (!(event instanceof CustomEvent)) return false;
  const detail = event.detail as EventDetail | undefined;
  return Boolean(
    detail &&
      detail.request &&
      ["buffer.create", "isochrone.create"].includes(detail.request.type) &&
      typeof detail.respond === "function",
  );
}
