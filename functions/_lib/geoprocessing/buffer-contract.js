export const BUFFER_UNITS = Object.freeze({
  METERS: "m",
  KILOMETERS: "km",
});

export const BUFFER_LIMITS = Object.freeze({
  MIN_RANGES: 1,
  MAX_RANGES: 4,
  MIN_RADIUS_METERS: 1,
  MAX_RADIUS_METERS: 200_000,
});

export const BUFFER_CRS = Object.freeze({
  SOURCE: "EPSG:4326",
  OUTPUT: "EPSG:4326",
  DISTANCE_MODE: "geodesic_meters",
});

const VALID_UNITS = new Set(Object.values(BUFFER_UNITS));

export function createBufferError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function normalizeProjectSlug(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw createBufferError(
      "O identificador do projeto é inválido.",
      400,
      "BUFFER_INPUT_INVALID",
      { field: "projectSlug" },
    );
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > 200) {
    throw createBufferError(
      "O identificador do projeto é inválido.",
      400,
      "BUFFER_INPUT_INVALID",
      { field: "projectSlug" },
    );
  }

  return normalized;
}

function numericCoordinate(value, minimum, maximum, code, field) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < minimum || numeric > maximum) {
    throw createBufferError(
      `A coordenada ${field} é inválida.`,
      400,
      code,
      { field, minimum, maximum },
    );
  }
  return numeric;
}

function normalizeUnit(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    throw createBufferError(
      "Informe a unidade dos raios.",
      400,
      "BUFFER_UNIT_REQUIRED",
      { allowed: [...VALID_UNITS] },
    );
  }
  if (!VALID_UNITS.has(normalized)) {
    throw createBufferError(
      "A unidade do buffer é inválida.",
      400,
      "BUFFER_UNIT_INVALID",
      { allowed: [...VALID_UNITS] },
    );
  }
  return normalized;
}

function metersFromRange(value, unit, index) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw createBufferError(
      "Cada raio deve ser um número positivo.",
      400,
      "BUFFER_RADIUS_INVALID",
      { field: `ranges[${index}]`, index },
    );
  }

  const multiplier = unit === BUFFER_UNITS.KILOMETERS ? 1000 : 1;
  const meters = Number((numeric * multiplier).toFixed(3));
  if (
    meters < BUFFER_LIMITS.MIN_RADIUS_METERS ||
    meters > BUFFER_LIMITS.MAX_RADIUS_METERS
  ) {
    throw createBufferError(
      "O raio informado está fora do intervalo permitido.",
      400,
      "BUFFER_RADIUS_OUT_OF_RANGE",
      {
        field: `ranges[${index}]`,
        index,
        minimumMeters: BUFFER_LIMITS.MIN_RADIUS_METERS,
        maximumMeters: BUFFER_LIMITS.MAX_RADIUS_METERS,
      },
    );
  }

  return { inputValue: numeric, meters };
}

export function normalizeBufferInput(rawInput) {
  if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput)) {
    throw createBufferError(
      "Envie um objeto de configuração de buffer válido.",
      400,
      "BUFFER_INPUT_INVALID",
    );
  }

  const projectSlug = normalizeProjectSlug(rawInput.projectSlug);
  const origin = rawInput.origin;
  if (!origin || typeof origin !== "object" || Array.isArray(origin)) {
    throw createBufferError(
      "Informe a origem do buffer.",
      400,
      "BUFFER_ORIGIN_REQUIRED",
    );
  }

  const latitude = numericCoordinate(
    origin.latitude ?? origin.lat,
    -90,
    90,
    "BUFFER_LATITUDE_INVALID",
    "latitude",
  );
  const longitude = numericCoordinate(
    origin.longitude ?? origin.lng ?? origin.lon,
    -180,
    180,
    "BUFFER_LONGITUDE_INVALID",
    "longitude",
  );
  const inputUnit = normalizeUnit(rawInput.unit);

  if (!Array.isArray(rawInput.ranges)) {
    throw createBufferError(
      "Informe pelo menos um raio.",
      400,
      "BUFFER_RANGES_REQUIRED",
      {
        minimum: BUFFER_LIMITS.MIN_RANGES,
        maximum: BUFFER_LIMITS.MAX_RANGES,
      },
    );
  }

  if (
    rawInput.ranges.length < BUFFER_LIMITS.MIN_RANGES ||
    rawInput.ranges.length > BUFFER_LIMITS.MAX_RANGES
  ) {
    throw createBufferError(
      "Informe entre um e quatro raios.",
      400,
      "BUFFER_RANGES_INVALID",
      {
        minimum: BUFFER_LIMITS.MIN_RANGES,
        maximum: BUFFER_LIMITS.MAX_RANGES,
      },
    );
  }

  const normalizedRanges = rawInput.ranges.map((value, index) =>
    metersFromRange(value, inputUnit, index),
  );
  const seen = new Set();
  for (const range of normalizedRanges) {
    const key = String(range.meters);
    if (seen.has(key)) {
      throw createBufferError(
        "Já existe um buffer com este raio.",
        400,
        "BUFFER_RADIUS_DUPLICATED",
        { radiusMeters: range.meters },
      );
    }
    seen.add(key);
  }

  normalizedRanges.sort((left, right) => left.meters - right.meters);

  return {
    projectSlug,
    origin: { latitude, longitude },
    inputUnit,
    ranges: normalizedRanges.map((range) => range.inputValue),
    rangesMeters: normalizedRanges.map((range) => range.meters),
    crs: {
      source: BUFFER_CRS.SOURCE,
      output: BUFFER_CRS.OUTPUT,
      distanceMode: BUFFER_CRS.DISTANCE_MODE,
    },
  };
}
