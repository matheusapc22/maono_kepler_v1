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
  component?: string | null;
  operation?: "create" | "update" | null;
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
