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
    antimeridianSplitCount: number;
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
const MAX_BUFFER_RADIUS_METERS = 200_000;
const UNITS = new Set<BufferUnit>(["m", "km"]);

function apiError(message: string, status: number, code: string) {
  const error = new Error(message) as BufferApiError;
  error.status = status;
  error.code = code;
  return error;
}

function invalidGeoJson(message: string): never {
  throw apiError(message, 502, "BUFFER_GEOJSON_INVALID");
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
  const antimeridianSplitCount = Number(value?.antimeridianSplitCount);
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
    rangesMeters.some(
      (range) =>
        !Number.isFinite(range) ||
        range <= 0 ||
        range > MAX_BUFFER_RADIUS_METERS,
    ) ||
    new Set(rangesMeters).size !== rangesMeters.length ||
    !Number.isInteger(featureCount) ||
    featureCount !== ranges.length ||
    !engine ||
    !Number.isInteger(segmentsPerQuadrant) ||
    segmentsPerQuadrant < 4 ||
    segmentsPerQuadrant > 64 ||
    !Number.isInteger(antimeridianSplitCount) ||
    antimeridianSplitCount < 0 ||
    antimeridianSplitCount > featureCount ||
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
    antimeridianSplitCount,
    crs: {
      source: "EPSG:4326",
      output: "EPSG:4326",
      distanceMode,
    },
    canPersist: value.canPersist,
  };
}

function coordinateEquals(left: unknown, right: unknown) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length >= 2 &&
    right.length >= 2 &&
    left[0] === right[0] &&
    left[1] === right[1]
  );
}

function validatePosition(value: unknown) {
  if (!Array.isArray(value) || value.length < 2) {
    invalidGeoJson("O serviço retornou uma posição geográfica inválida.");
  }

  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    invalidGeoJson("O serviço retornou coordenadas fora dos limites válidos.");
  }
}

function validateLinearRing(value: unknown) {
  if (!Array.isArray(value) || value.length < 4) {
    invalidGeoJson("O serviço retornou um anel GeoJSON incompleto.");
  }

  value.forEach(validatePosition);
  if (!coordinateEquals(value[0], value[value.length - 1])) {
    invalidGeoJson("O serviço retornou um anel GeoJSON não fechado.");
  }

  for (let index = 1; index < value.length; index += 1) {
    const previous = value[index - 1] as number[];
    const current = value[index] as number[];
    if (Math.abs(Number(current[0]) - Number(previous[0])) > 180) {
      invalidGeoJson(
        "O serviço retornou um polígono com salto inválido no antimeridiano.",
      );
    }
  }
}

function validatePolygonCoordinates(value: unknown) {
  if (!Array.isArray(value) || value.length < 1) {
    invalidGeoJson("O serviço retornou um Polygon sem anéis.");
  }
  value.forEach(validateLinearRing);
}

function validateGeometry(value: any) {
  if (!value || typeof value !== "object") {
    invalidGeoJson("O serviço retornou uma geometria ausente.");
  }

  if (value.type === "Polygon") {
    validatePolygonCoordinates(value.coordinates);
    return;
  }

  if (value.type === "MultiPolygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length < 2) {
      invalidGeoJson(
        "O serviço retornou um MultiPolygon sem partes suficientes.",
      );
    }
    value.coordinates.forEach(validatePolygonCoordinates);
    return;
  }

  invalidGeoJson(
    "O serviço retornou um tipo de geometria incompatível com Buffer radial.",
  );
}

function validateFeatureProperties(value: any, inputUnit: BufferUnit) {
  if (!value || typeof value !== "object") {
    invalidGeoJson("O serviço retornou propriedades de Buffer ausentes.");
  }

  const radiusMeters = Number(value.radius_m);
  const analysisLabel =
    typeof value.analysis_label === "string"
      ? value.analysis_label.trim()
      : "";
  const radiusLabel =
    typeof value.radius_label === "string"
      ? value.radius_label.trim()
      : "";

  if (
    value.maono_analysis !== "radial_buffer" ||
    !analysisLabel ||
    !radiusLabel ||
    !Number.isFinite(radiusMeters) ||
    radiusMeters <= 0 ||
    radiusMeters > MAX_BUFFER_RADIUS_METERS ||
    value.input_unit !== inputUnit
  ) {
    invalidGeoJson(
      "O serviço retornou propriedades incompatíveis com Buffer radial.",
    );
  }

  return radiusMeters;
}

function validateBufferGeoJson(
  value: any,
  metadata: BufferResult["metadata"],
): BufferFeatureCollection {
  if (
    value?.type !== "FeatureCollection" ||
    !Array.isArray(value?.features) ||
    value.features.length < 1 ||
    value.features.length > 4 ||
    value.features.length !== metadata.featureCount
  ) {
    invalidGeoJson(
      "O serviço não retornou uma coleção GeoJSON de Buffer válida.",
    );
  }

  const featureRadii = value.features.map((feature: any) => {
    if (!feature || feature.type !== "Feature") {
      invalidGeoJson("O serviço retornou uma Feature de Buffer inválida.");
    }
    validateGeometry(feature.geometry);
    return validateFeatureProperties(feature.properties, metadata.inputUnit);
  });

  const expected = [...metadata.rangesMeters].sort((left, right) => left - right);
  const actual = [...featureRadii].sort((left, right) => left - right);
  if (
    expected.length !== actual.length ||
    expected.some(
      (valueAtIndex, index) =>
        Math.abs(valueAtIndex - actual[index]) > 1e-6,
    )
  ) {
    invalidGeoJson(
      "Os raios do GeoJSON não correspondem aos metadados retornados.",
    );
  }

  const splitFeatures = value.features.filter(
    (feature: any) => feature?.geometry?.type === "MultiPolygon",
  ).length;
  if (splitFeatures !== metadata.antimeridianSplitCount) {
    invalidGeoJson(
      "A geometria e os metadados do antimeridiano são inconsistentes.",
    );
  }

  return value as BufferFeatureCollection;
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

  if (api?.code === "BUFFER_POLAR_CAP_UNSUPPORTED") {
    return "Buffers que envolvem um dos polos ainda não são suportados nesta versão.";
  }

  if (api?.code === "BUFFER_GEOMETRY_SPAN_UNSUPPORTED") {
    return "Esta extensão geográfica ainda não é suportada pelo Buffer radial.";
  }

  if (
    api?.code === "BUFFER_GEOJSON_INVALID" ||
    api?.code === "BUFFER_METADATA_INVALID"
  ) {
    return "O serviço retornou uma geometria de Buffer inválida e ela não foi adicionada ao mapa.";
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

    const metadata = normalizedMetadata(data.metadata);
    const geojson = validateBufferGeoJson(data.geojson, metadata);

    return {
      geojson,
      metadata,
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
