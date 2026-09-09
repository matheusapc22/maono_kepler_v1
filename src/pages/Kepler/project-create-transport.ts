import {
  measureUtf8PayloadBytes,
  serializeMapConfigTransport,
  type ClientSaveAttempt,
  type SerializedMapConfigTransport,
} from "./save-observability";

type LegacyPreview = {
  dataUrl: string;
  method: string;
  diagnostics: string[];
} | null;

export type PreparedProjectCreateTransport = {
  large: boolean;
  requestBody: string;
  configBody: string;
  payloadBytes: number;
  configPayloadBytes: number;
  serializeDurationMs: number;
  configTransport: SerializedMapConfigTransport;
};

function appendRawConfigToJsonEnvelope(
  metadata: Record<string, unknown>,
  configBody: string,
) {
  const envelope = JSON.stringify(metadata);
  if (!envelope.endsWith("}")) {
    throw new Error("Não foi possível preparar a criação do projeto.");
  }
  return `${envelope.slice(0, -1)},"config":${configBody}}`;
}

export function prepareProjectCreateTransport(
  attempt: ClientSaveAttempt,
  {
    name,
    description,
    organizationId,
    idempotencyKey,
    config,
    legacy,
  }: {
    name: string;
    description: string;
    organizationId: unknown;
    idempotencyKey: string;
    config: any;
    legacy: LegacyPreview;
  },
): PreparedProjectCreateTransport {
  const configTransport = serializeMapConfigTransport(attempt, config, 0);
  const previewMetadata = legacy
    ? {
        thumbnailDataUrl: legacy.dataUrl,
        thumbnailCapture: {
          method: legacy.method,
          diagnostics: legacy.diagnostics.join(" | "),
        },
      }
    : {};

  if (configTransport.large) {
    const requestBody = JSON.stringify({
      name,
      description,
      organizationId,
      idempotencyKey,
      largeConfig: true,
      configMetadata: {
        sizeBytes: configTransport.payloadBytes,
        configVersion: String(config?.version || "").slice(0, 80),
        datasetCount: Array.isArray(config?.datasets)
          ? config.datasets.length
          : 0,
        schemaName: "legacy-kepler",
        schemaVersion: 1,
      },
    });

    return {
      large: true,
      requestBody,
      configBody: configTransport.body,
      payloadBytes: configTransport.payloadBytes,
      configPayloadBytes: configTransport.payloadBytes,
      serializeDurationMs: configTransport.serializeDurationMs,
      configTransport,
    };
  }

  const requestBody = appendRawConfigToJsonEnvelope(
    {
      name,
      description,
      organizationId,
      idempotencyKey,
      ...previewMetadata,
    },
    configTransport.body,
  );

  return {
    large: false,
    requestBody,
    configBody: configTransport.body,
    payloadBytes: measureUtf8PayloadBytes(requestBody),
    configPayloadBytes: configTransport.payloadBytes,
    serializeDurationMs: configTransport.serializeDurationMs,
    configTransport,
  };
}
