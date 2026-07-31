import { requireSession } from "./auth.js";
import {
  can,
  recordAuditLog,
} from "./permissions.js";
import {
  getActiveOrganizationId,
  getAuthorizedProject,
} from "./projects.js";
import { getMapPanelFeatures } from "./map-panel-service.js";

const GEOAPIFY_ISOLINE_URL =
  "https://api.geoapify.com/v1/isoline";
const SUPPORTED_TYPES = new Set(["time", "distance"]);
const SUPPORTED_MODES = new Set([
  "drive_traffic",
  "drive",
  "bicycle",
  "walk",
]);
const MAX_RANGES = 4;
const MAX_TIME_MINUTES = 240;
const MAX_DISTANCE_KILOMETERS = 100;
const MAX_PROVIDER_RESPONSE_BYTES = 3 * 1024 * 1024;
const MAX_PROVIDER_FEATURES = 12;
const MAX_PROVIDER_COORDINATES = 50_000;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_RATE_LIMIT = 8;
const DEFAULT_RATE_WINDOW_SECONDS = 300;

function createIsochroneError(
  message,
  status,
  code,
  details = null,
) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function numberInRange(value, minimum, maximum, field) {
  const normalized = Number(value);

  if (
    !Number.isFinite(normalized) ||
    normalized < minimum ||
    normalized > maximum
  ) {
    throw createIsochroneError(
      `O campo ${field} está fora do intervalo permitido.`,
      400,
      "ISOCHRONE_PARAMETER_INVALID",
      { field, minimum, maximum },
    );
  }

  return normalized;
}

function positiveInteger(value, fallback, minimum, maximum) {
  const normalized = Number.parseInt(String(value ?? ""), 10);

  return Number.isFinite(normalized)
    ? Math.min(maximum, Math.max(minimum, normalized))
    : fallback;
}

export function normalizeIsochroneInput(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  const type = String(input.type || "").trim().toLowerCase();
  const mode = String(input.mode || "").trim().toLowerCase();

  if (!SUPPORTED_TYPES.has(type)) {
    throw createIsochroneError(
      "O tipo de isócrona é inválido.",
      400,
      "ISOCHRONE_TYPE_INVALID",
    );
  }

  if (!SUPPORTED_MODES.has(mode)) {
    throw createIsochroneError(
      "A modalidade de deslocamento é inválida.",
      400,
      "ISOCHRONE_MODE_INVALID",
    );
  }

  if (!Array.isArray(input.ranges)) {
    throw createIsochroneError(
      "Os intervalos da isócrona são obrigatórios.",
      400,
      "ISOCHRONE_RANGES_REQUIRED",
    );
  }

  const maximum =
    type === "time"
      ? MAX_TIME_MINUTES
      : MAX_DISTANCE_KILOMETERS;
  const minimum = type === "time" ? 1 : 0.1;
  const ranges = [
    ...new Set(
      input.ranges.map((range, index) =>
        numberInRange(
          range,
          minimum,
          maximum,
          `ranges[${index}]`,
        ),
      ),
    ),
  ].sort((left, right) => left - right);

  if (ranges.length < 1 || ranges.length > MAX_RANGES) {
    throw createIsochroneError(
      "Informe entre um e quatro intervalos.",
      400,
      "ISOCHRONE_RANGES_INVALID",
      { minimum: 1, maximum: MAX_RANGES },
    );
  }

  const origin = input.origin || {};
  const latitude = numberInRange(
    origin.latitude ?? origin.lat,
    -90,
    90,
    "origin.latitude",
  );
  const longitude = numberInRange(
    origin.longitude ?? origin.lng ?? origin.lon,
    -180,
    180,
    "origin.longitude",
  );
  const projectSlug = String(input.projectSlug || "").trim() || null;

  return {
    projectSlug,
    origin: { latitude, longitude },
    type,
    mode,
    ranges,
  };
}

function providerRanges(input) {
  const multiplier = input.type === "time" ? 60 : 1000;

  return input.ranges.map((range) =>
    Math.round(range * multiplier),
  );
}

function providerMode(mode) {
  return mode === "drive_traffic" ? "drive" : mode;
}

function providerTraffic(mode) {
  if (mode === "drive_traffic") return "approximated";
  if (mode === "drive") return "free_flow";
  return null;
}

function providerUrl(apiKey, input, id = null) {
  const url = new URL(GEOAPIFY_ISOLINE_URL);

  url.searchParams.set("apiKey", apiKey);

  if (id) {
    url.searchParams.set("id", id);
    return url;
  }

  url.searchParams.set("lat", String(input.origin.latitude));
  url.searchParams.set("lon", String(input.origin.longitude));
  url.searchParams.set("type", input.type);
  url.searchParams.set("mode", providerMode(input.mode));
  url.searchParams.set(
    "range",
    providerRanges(input).join(","),
  );
  const traffic = providerTraffic(input.mode);
  if (traffic) url.searchParams.set("traffic", traffic);

  return url;
}

async function parseProviderJson(response) {
  const declaredLength = Number(
    response.headers?.get?.("content-length") || 0,
  );

  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_PROVIDER_RESPONSE_BYTES
  ) {
    throw createIsochroneError(
      "A resposta do provedor excedeu o limite permitido.",
      502,
      "ISOCHRONE_PROVIDER_RESPONSE_TOO_LARGE",
    );
  }

  const reader = response.body?.getReader?.();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = "";

  if (reader) {
    try {
      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        receivedBytes += value.byteLength;

        if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
          await reader.cancel();
          throw createIsochroneError(
            "A resposta do provedor excedeu o limite permitido.",
            502,
            "ISOCHRONE_PROVIDER_RESPONSE_TOO_LARGE",
          );
        }

        text += decoder.decode(value, { stream: true });
      }

      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } else {
    text = await response.text();
    receivedBytes = new TextEncoder().encode(text).byteLength;

    if (receivedBytes > MAX_PROVIDER_RESPONSE_BYTES) {
      throw createIsochroneError(
        "A resposta do provedor excedeu o limite permitido.",
        502,
        "ISOCHRONE_PROVIDER_RESPONSE_TOO_LARGE",
      );
    }
  }

  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw createIsochroneError(
      "O provedor retornou uma resposta inválida.",
      502,
      "ISOCHRONE_PROVIDER_INVALID_RESPONSE",
    );
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function providerRequest({
  apiKey,
  fetchImpl,
  input,
  signal,
  waitImpl,
}) {
  let response = await fetchImpl(
    providerUrl(apiKey, input),
    {
      method: "GET",
      headers: { Accept: "application/geo+json, application/json" },
      signal,
    },
  );
  let data = await parseProviderJson(response);

  if (response.status === 202) {
    const id = String(data?.properties?.id || "").trim();

    if (!id) {
      throw createIsochroneError(
        "O provedor aceitou a análise sem retornar um identificador.",
        502,
        "ISOCHRONE_PROVIDER_PENDING_WITHOUT_ID",
      );
    }

    for (const delay of [400, 900, 1_800, 3_200]) {
      await waitImpl(delay);
      response = await fetchImpl(
        providerUrl(apiKey, input, id),
        {
          method: "GET",
          headers: {
            Accept: "application/geo+json, application/json",
          },
          signal,
        },
      );
      data = await parseProviderJson(response);

      if (response.status !== 202) break;
    }
  }

  if (response.status === 202) {
    throw createIsochroneError(
      "A análise ainda está sendo processada. Tente novamente em alguns instantes.",
      503,
      "ISOCHRONE_PROVIDER_PENDING",
      { retryable: true },
    );
  }

  if (!response.ok) {
    throw createIsochroneError(
      response.status === 429
        ? "O provedor atingiu o limite temporário de requisições."
        : "O provedor não conseguiu gerar a isócrona.",
      response.status === 429 ? 503 : 502,
      response.status === 429
        ? "ISOCHRONE_PROVIDER_RATE_LIMITED"
        : "ISOCHRONE_PROVIDER_ERROR",
      {
        providerStatus: response.status,
        retryable: response.status >= 429,
      },
    );
  }

  return data;
}

function sanitizePosition(position, coordinateBudget) {
  if (!Array.isArray(position) || position.length < 2) {
    return null;
  }

  const longitude = Number(position[0]);
  const latitude = Number(position[1]);

  if (
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude) ||
    longitude < -180 ||
    longitude > 180 ||
    latitude < -90 ||
    latitude > 90
  ) {
    return null;
  }

  coordinateBudget.count += 1;

  if (coordinateBudget.count > MAX_PROVIDER_COORDINATES) {
    throw createIsochroneError(
      "A geometria retornada pelo provedor excedeu o limite permitido.",
      502,
      "ISOCHRONE_PROVIDER_GEOMETRY_TOO_COMPLEX",
    );
  }

  return [longitude, latitude];
}

function sanitizeLinearRing(ring, coordinateBudget) {
  if (!Array.isArray(ring) || ring.length < 4) {
    return null;
  }

  const sanitized = ring.map((position) =>
    sanitizePosition(position, coordinateBudget),
  );

  if (sanitized.some((position) => !position)) {
    return null;
  }

  const first = sanitized[0];
  const last = sanitized[sanitized.length - 1];

  if (first[0] !== last[0] || first[1] !== last[1]) {
    return null;
  }

  return sanitized;
}

function sanitizePolygonCoordinates(coordinates, coordinateBudget) {
  if (!Array.isArray(coordinates) || coordinates.length < 1) {
    return null;
  }

  const rings = coordinates.map((ring) =>
    sanitizeLinearRing(ring, coordinateBudget),
  );

  return rings.some((ring) => !ring) ? null : rings;
}

function sanitizeGeometry(geometry, coordinateBudget) {
  if (!geometry || !Array.isArray(geometry.coordinates)) {
    return null;
  }

  if (geometry.type === "Polygon") {
    const coordinates = sanitizePolygonCoordinates(
      geometry.coordinates,
      coordinateBudget,
    );

    return coordinates
      ? { type: "Polygon", coordinates }
      : null;
  }

  if (geometry.type === "MultiPolygon") {
    if (geometry.coordinates.length < 1) {
      return null;
    }

    const coordinates = geometry.coordinates.map((polygon) =>
      sanitizePolygonCoordinates(polygon, coordinateBudget),
    );

    return coordinates.some((polygon) => !polygon)
      ? null
      : { type: "MultiPolygon", coordinates };
  }

  return null;
}

function sanitizeFeature(feature, input, coordinateBudget) {
  const geometry = feature?.geometry;
  const sanitizedGeometry = sanitizeGeometry(
    geometry,
    coordinateBudget,
  );

  if (!sanitizedGeometry) {
    return null;
  }

  const rangeRaw = Number(feature?.properties?.range);
  const multiplier = input.type === "time" ? 60 : 1000;
  const displayRange = Number.isFinite(rangeRaw)
    ? rangeRaw / multiplier
    : null;

  return {
    type: "Feature",
    geometry: sanitizedGeometry,
    properties: {
      maono_analysis: "isochrone",
      type: input.type,
      mode: input.mode,
      traffic: providerTraffic(input.mode),
      range: displayRange,
      unit: input.type === "time" ? "minutes" : "kilometers",
    },
  };
}

export function sanitizeIsochroneGeoJson(data, input) {
  if (
    data?.type !== "FeatureCollection" ||
    !Array.isArray(data.features)
  ) {
    throw createIsochroneError(
      "O provedor não retornou uma coleção GeoJSON válida.",
      502,
      "ISOCHRONE_PROVIDER_GEOJSON_INVALID",
    );
  }

  const coordinateBudget = { count: 0 };
  const polygons = data.features
    .map((feature) =>
      sanitizeFeature(feature, input, coordinateBudget),
    )
    .filter(Boolean)
    .slice(0, MAX_PROVIDER_FEATURES);

  if (!polygons.length) {
    throw createIsochroneError(
      "Nenhuma área alcançável foi encontrada para os parâmetros informados.",
      422,
      "ISOCHRONE_EMPTY_RESULT",
    );
  }

  return {
    type: "FeatureCollection",
    features: [
      ...polygons,
      {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [
            input.origin.longitude,
            input.origin.latitude,
          ],
        },
        properties: {
          maono_analysis: "isochrone_origin",
          label: "Origem",
        },
      },
    ],
  };
}

async function safeAudit(env, event) {
  try {
    await recordAuditLog(env, event);
  } catch (error) {
    console.error("[Maono isochrones] Falha de auditoria:", error);
  }
}

async function resolveAccess(env, request, input, options) {
  const user = options.user || await requireSession(env, request);
  const features = getMapPanelFeatures(env);

  if (!features.maonoIsochrone) {
    throw createIsochroneError(
      "A ferramenta de isócronas não está disponível neste ambiente.",
      503,
      "ISOCHRONE_FEATURE_DISABLED",
    );
  }

  if (input.projectSlug) {
    const project = await getAuthorizedProject(
      env,
      user,
      input.projectSlug,
    );

    if (!project) {
      throw createIsochroneError(
        "Projeto não encontrado.",
        404,
        "PROJECT_NOT_FOUND",
      );
    }

    const context = {
      project,
      projectId: project.id,
      projectSlug: project.slug,
      organizationId: project.organization_id,
      scopeType: "project",
    };
    const [viewDecision, editDecision, saveDecision] =
      await Promise.all([
        can(env, user, "project.view", context),
        can(env, user, "project.map.edit", context),
        can(env, user, "project.save", context),
      ]);

    if (!viewDecision.allowed) {
      throw createIsochroneError(
        "Você não possui permissão para gerar análises neste mapa.",
        403,
        "ISOCHRONE_PREVIEW_FORBIDDEN",
      );
    }

    return {
      user,
      organizationId: project.organization_id,
      projectId: project.id,
      canPersist:
        editDecision.allowed && saveDecision.allowed,
    };
  }

  const organizationId = getActiveOrganizationId(user);

  if (!organizationId) {
    throw createIsochroneError(
      "Selecione uma organização ativa.",
      409,
      "ACTIVE_ORGANIZATION_REQUIRED",
    );
  }

  const createDecision = await can(
    env,
    user,
    "project.create",
    {
      organizationId,
      scopeType: "organization",
    },
  );

  if (!createDecision.allowed) {
    throw createIsochroneError(
      "Você não possui permissão para gerar análises em um novo mapa.",
      403,
      "ISOCHRONE_PREVIEW_FORBIDDEN",
    );
  }

  return {
    user,
    organizationId,
    projectId: null,
    canPersist: true,
  };
}

export async function consumeIsochroneRateLimit(
  env,
  {
    userId,
    organizationId,
    now = new Date(),
  },
) {
  const limit = positiveInteger(
    env?.ISOCHRONE_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT,
    1,
    100,
  );
  const windowSeconds = positiveInteger(
    env?.ISOCHRONE_RATE_LIMIT_WINDOW_SECONDS,
    DEFAULT_RATE_WINDOW_SECONDS,
    60,
    3600,
  );
  const windowMilliseconds = windowSeconds * 1000;
  const windowStart = new Date(
    Math.floor(now.getTime() / windowMilliseconds) *
      windowMilliseconds,
  );
  const expiresAt = new Date(
    windowStart.getTime() + windowMilliseconds,
  );

  try {
    await env.DB.prepare(
      `DELETE FROM map_analysis_rate_limits
       WHERE expires_at < ?`,
    )
      .bind(
        new Date(now.getTime() - 86_400_000).toISOString(),
      )
      .run();

    const row = await env.DB.prepare(
      `INSERT INTO map_analysis_rate_limits (
         user_id,
         organization_id,
         analysis_type,
         bucket_started_at,
         request_count,
         expires_at,
         updated_at
       )
       VALUES (?, ?, 'isochrone', ?, 1, ?, ?)
       ON CONFLICT (
         user_id,
         organization_id,
         analysis_type,
         bucket_started_at
       )
       DO UPDATE SET
         request_count = request_count + 1,
         expires_at = excluded.expires_at,
         updated_at = excluded.updated_at
       WHERE request_count < ?
       RETURNING request_count`,
    )
      .bind(
        String(userId),
        organizationId,
        windowStart.toISOString(),
        expiresAt.toISOString(),
        now.toISOString(),
        limit,
      )
      .first();

    if (!row) {
      throw createIsochroneError(
        "Muitas análises foram solicitadas. Aguarde antes de tentar novamente.",
        429,
        "ISOCHRONE_RATE_LIMITED",
        {
          retryAfterSeconds: Math.max(
            1,
            Math.ceil(
              (expiresAt.getTime() - now.getTime()) / 1000,
            ),
          ),
        },
      );
    }

    return {
      count: Number(row.request_count),
      limit,
      windowSeconds,
    };
  } catch (error) {
    if (error?.code === "ISOCHRONE_RATE_LIMITED") {
      throw error;
    }

    throw createIsochroneError(
      "O controle de uso da ferramenta não está disponível.",
      503,
      "ISOCHRONE_RATE_LIMIT_UNAVAILABLE",
    );
  }
}

export async function generateIsochrone(
  env,
  request,
  rawInput,
  options = {},
) {
  const startedAt = Date.now();
  const input = normalizeIsochroneInput(rawInput);
  const access = await resolveAccess(
    env,
    request,
    input,
    options,
  );
  const auditBase = {
    actorUserId: access.user.id,
    organizationId: access.organizationId,
    projectId: access.projectId,
    resourceType: access.projectId ? "project" : "organization",
    resourceId: access.projectId || access.organizationId,
    request,
  };
  const apiKey = String(env?.GEOAPIFY_API_KEY || "").trim();

  if (!apiKey) {
    throw createIsochroneError(
      "O provedor de isócronas não está configurado.",
      503,
      "ISOCHRONE_PROVIDER_NOT_CONFIGURED",
    );
  }

  await consumeIsochroneRateLimit(env, {
    userId: access.user.id,
    organizationId: access.organizationId,
    now: options.now || new Date(),
  });

  const fetchImpl = options.fetchImpl || fetch;
  const waitImpl = options.waitImpl || wait;
  const timeoutMs = positiveInteger(
    env?.ISOCHRONE_PROVIDER_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    3_000,
    30_000,
  );
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  if (request?.signal) {
    request.signal.addEventListener(
      "abort",
      () => controller.abort(),
      { once: true },
    );
  }

  try {
    const providerData = await providerRequest({
      apiKey,
      fetchImpl,
      input,
      signal: controller.signal,
      waitImpl,
    });
    const geojson = sanitizeIsochroneGeoJson(
      providerData,
      input,
    );
    const metadata = {
      type: input.type,
      mode: input.mode,
      ranges: input.ranges,
      featureCount: geojson.features.length,
      provider: "geoapify",
      canPersist: access.canPersist,
    };

    await safeAudit(env, {
      ...auditBase,
      action: "projects.map.isochrone.preview",
      result: "success",
      metadata: {
        type: input.type,
        mode: input.mode,
        rangeCount: input.ranges.length,
        featureCount: geojson.features.length,
        durationMs: Date.now() - startedAt,
      },
    });

    return { geojson, metadata };
  } catch (error) {
    await safeAudit(env, {
      ...auditBase,
      action: "projects.map.isochrone.preview",
      result: "error",
      metadata: {
        type: input.type,
        mode: input.mode,
        rangeCount: input.ranges.length,
        durationMs: Date.now() - startedAt,
        code: error?.code || "ISOCHRONE_UNKNOWN_ERROR",
      },
    });

    if (
      error?.name === "AbortError" ||
      controller.signal.aborted
    ) {
      throw createIsochroneError(
        "O provedor demorou além do limite permitido.",
        504,
        "ISOCHRONE_PROVIDER_TIMEOUT",
        { retryable: true },
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
