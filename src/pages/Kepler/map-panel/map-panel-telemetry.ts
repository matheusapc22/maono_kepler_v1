type MapPanelTelemetryDetails = {
  mode?: string | null;
  projectId?: string | number | null;
  organizationId?: string | number | null;
  defaultPanel?: string | null;
  policyVersion?: number | null;
  command?: string | null;
  capability?: string | null;
  source?: string | null;
  reason?: string | null;
  code?: string | null;
  category?: string | null;
  component?: string | null;
  operation?: "create" | "update" | null;
  status?: string | null;
  stage?: string | null;
  saveId?: string | null;
  correlationId?: string | null;
  payloadBytes?: number | null;
  serializeDurationMs?: number | null;
  durationMs?: number | null;
  httpStatus?: number | null;
  retryable?: boolean | null;
  serverTiming?: string | null;
  expectedRevision?: number | null;
  candidateRevision?: number | null;
  provider?: string | null;
  providerStatus?: number | null;
  rowCount?: number | null;
  analysisType?: string | null;
  travelMode?: string | null;
  unit?: string | null;
  rangeCount?: number | null;
  featureCount?: number | null;
  itemCount?: number | null;
  sessionId?: string | null;
  dataId?: string | null;
  antimeridianSplitCount?: number | null;
  styleId?: string | null;
  persistence?: "project" | "session" | null;
};

export function emitMapPanelTelemetry(
  event: string,
  details: MapPanelTelemetryDetails = {},
) {
  window.dispatchEvent(
    new CustomEvent("maono:map-panel-telemetry", {
      detail: {
        event,
        ...details,
      },
    }),
  );
}
