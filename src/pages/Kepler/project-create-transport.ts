import { measureUtf8PayloadBytes, serializeMapConfigTransport, type ClientSaveAttempt, type SerializedMapConfigTransport } from "./save-observability.ts";

export type PreparedProjectCreateTransport = {
  large: boolean; requestBody: string; configBody: string; payloadBytes: number; configPayloadBytes: number;
  serializeDurationMs: number; configTransport: SerializedMapConfigTransport;
};
/** All sizes reserve metadata first, then send the exact frozen bytes through the operation core. */
export function prepareProjectCreateTransport(attempt: ClientSaveAttempt, { name, description, organizationId, idempotencyKey, config }: {
  name: string; description: string; organizationId: unknown; idempotencyKey: string; config: any;
  legacy?: unknown;
}): PreparedProjectCreateTransport {
  const configTransport = serializeMapConfigTransport(attempt, config, 0);
  const requestBody = JSON.stringify({ name, description, organizationId, idempotencyKey, durableSave: true,
    operationId: attempt.saveId,
    configMetadata: { sizeBytes: configTransport.payloadBytes, configVersion: String(config?.version || "").slice(0, 80), datasetCount: Array.isArray(config?.datasets) ? config.datasets.length : 0, schemaName: "legacy-kepler", schemaVersion: 1 },
  });
  return { large: configTransport.large, requestBody, configBody: configTransport.body, payloadBytes: measureUtf8PayloadBytes(requestBody), configPayloadBytes: configTransport.payloadBytes, serializeDurationMs: configTransport.serializeDurationMs, configTransport };
}
