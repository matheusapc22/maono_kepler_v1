export type BufferUnit = "m" | "km";

export type BufferRequest = {
  projectSlug?: string | null;
  origin: {
    latitude: number;
    longitude: number;
  };
  unit: BufferUnit;
  ranges: number[];
};

export type BufferFeatureCollection = {
  type: "FeatureCollection";
  features: Array<Record<string, unknown>>;
};

export type BufferResult = {
  geojson: BufferFeatureCollection;
  metadata: {
    analysis: "radial_buffer";
    ranges: number[];
    inputUnit: BufferUnit;
    rangesMeters: number[];
    featureCount: number;
    engine: string;
    segmentsPerQuadrant: number;
    crs: {
      source: "EPSG:4326";
      output: "EPSG:4326";
      distanceMode: string;
    };
    canPersist: boolean;
  };
};

export type BufferApiError = Error & {
  status?: number;
  code?: string;
};

const CLIENT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARACTERS = 1024 * 1024;
const UNITS = new Set<BufferUnit>(["m", "km"]);

function apiError(message: string, status: number, code: string) {
  const error = new Error(message) as BufferApiError;
  error.status = status;
  error.code = code;
  return error;
}

export function parseBufferNumber(value: string | number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatBufferEditableNumber(value: number) {
  if (!Number.isFinite(value)) return "";
  return Number(value.toFixed(6)).toString().replace(".", ",");
}

export function convertBufferDistance(
  value: number,
  from: BufferUnit,
  to: BufferUnit,
) {
  if (!Number.isFinite(value)) return Number.NaN;
  if (from === to) return value;

  const converted = from === "m" ? value / 1000 : value * 1000;
  return Number(converted.toFixed(6));
}

export function convertBufferDistanceText(
  value: string,
  from: BufferUnit,
  to: BufferUnit,
) {
  if (!value.trim()) return "";
  const parsed = parseBufferNumber(value);
  if (parsed === null) return null;
  return formatBufferEditableNumber(convertBufferDistance(parsed, from, to));
}

function normalizeNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(Number);
}

function normalizedMetadata(value: any): BufferResult["metadata"] {
  const ranges = normalizeNumberArray(value?.ranges);
  const rangesMeters = normalizeNumberArray(value?.rangesMeters);
  const inputUnit = value?.inputUnit as BufferUnit;
  const featureCount = Number(value?.featureCount);
  const engine = typeof value?.engine === "string" ? value.engine.trim() : "";
  const segmentsPerQuadrant = Number(value?.segmentsPerQuadrant);
  const source = value?.crs?.source;
  const output = value?.crs?.output;
  const distanceMode =
    typeof value?.crs?.distanceMode === "string"
      ? value.crs.distanceMode.trim()
      : "";

  if (
    value?.analysis !== "radial_buffer" ||
    !UNITS.has(inputUnit) ||
    ranges.length < 1 ||
    ranges.length > 4 ||
    ranges.some((range) => !Number.isFinite(range) || range <= 0) ||
    rangesMeters.length !== ranges.length ||
    rangesMeters.some((range) => !Number.isFinite(range) || range <= 0) ||
    !Number.isInteger(featureCount) ||
    featureCount < 1 ||
    !engine ||
    !Number.isInteger(segmentsPerQuadrant) ||
    segmentsPerQuadrant < 1 ||
    source !== "EPSG:4326" ||
    output !== "EPSG:4326" ||
    !distanceMode ||
    typeof value?.canPersist !== "boolean"
  ) {
    throw apiError(
      "O serviço retornou metadados de buffer inválidos.",
      502,
      "BUFFER_METADATA_INVALID",
    );
  }

  return {
    analysis: "radial_buffer",
    ranges,
    inputUnit,
    rangesMeters,
    featureCount,
    engine,
    segmentsPerQuadrant,
    crs: {
      source: "EPSG:4326",
      output: "EPSG:4326",
      distanceMode,
    },
    canPersist: value.canPersist,
  };
}

async function readJson(response: Response) {
  const text = await response.text();

  if (text.length > MAX_RESPONSE_CHARACTERS) {
    throw apiError(
      "O serviço de buffers retornou dados acima do limite permitido.",
      502,
      "BUFFER_RESPONSE_TOO_LARGE",
    );
  }

  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw apiError(
      "O serviço de buffers retornou uma resposta inválida.",
      response.status,
      "BUFFER_INVALID_RESPONSE",
    );
  }
}

export function isBufferAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      (error as BufferApiError).code === "BUFFER_REQUEST_ABORTED")
  );
}

export function bufferErrorMessage(error: unknown) {
  const api = error as BufferApiError;

  if (api?.code === "BUFFER_FEATURE_DISABLED") {
    return "A ferramenta de buffers está indisponível neste ambiente.";
  }

  if (api?.code === "BUFFER_ANTIMERIDIAN_UNSUPPORTED") {
    return "Esta área ainda não é suportada pela primeira versão do Buffer.";
  }

  if (api?.code === "BUFFER_CLIENT_TIMEOUT") {
    return "A geração do buffer demorou além do esperado. Tente novamente.";
  }

  if (api?.status === 401) {
    return "Sua sessão expirou. Entre novamente para gerar a análise.";
  }

  if (api?.status === 403) {
    return "Você não possui permissão para gerar esta análise.";
  }

  if (api?.status && api.status >= 500) {
    return "O serviço de buffers está temporariamente indisponível.";
  }

  if (
    error instanceof TypeError &&
    /fetch|network|load failed/i.test(error.message)
  ) {
    return "Não foi possível conectar ao serviço de buffers.";
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : "Não foi possível gerar os buffers.";
}

export async function requestBuffer(
  input: BufferRequest,
  signal?: AbortSignal,
): Promise<BufferResult> {
  const controller = new AbortController();
  let timedOut = false;
  const handleAbort = () => controller.abort(signal?.reason);
  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CLIENT_TIMEOUT_MS);

  signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    const response = await fetch("/api/maps/buffers", {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "MaonoMap",
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const data = await readJson(response);

    if (!response.ok || !data?.ok) {
      throw apiError(
        data?.error?.message || "Não foi possível gerar os buffers agora.",
        response.status,
        data?.error?.code || "BUFFER_REQUEST_FAILED",
      );
    }

    if (
      data.geojson?.type !== "FeatureCollection" ||
      !Array.isArray(data.geojson?.features)
    ) {
      throw apiError(
        "O serviço não retornou um GeoJSON válido.",
        502,
        "BUFFER_GEOJSON_MISSING",
      );
    }

    return {
      geojson: data.geojson,
      metadata: normalizedMetadata(data.metadata),
    };
  } catch (error) {
    if (timedOut) {
      throw apiError(
        "A solicitação de buffer excedeu o tempo limite.",
        504,
        "BUFFER_CLIENT_TIMEOUT",
      );
    }

    if (signal?.aborted || isBufferAbortError(error)) {
      const aborted = apiError(
        "A solicitação de buffer foi cancelada.",
        499,
        "BUFFER_REQUEST_ABORTED",
      );
      aborted.name = "AbortError";
      throw aborted;
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleAbort);
  }
}
