export type IsochroneType = "time" | "distance";

export type IsochroneMode =
  | "drive_traffic"
  | "drive"
  | "bicycle"
  | "walk";

export type IsochroneRequest = {
  projectSlug?: string | null;
  origin: {
    latitude: number;
    longitude: number;
  };
  type: IsochroneType;
  mode: IsochroneMode;
  ranges: number[];
};

export type IsochroneFeatureCollection = {
  type: "FeatureCollection";
  features: Array<Record<string, unknown>>;
};

export type IsochroneResult = {
  geojson: IsochroneFeatureCollection;
  metadata: {
    type: IsochroneType;
    mode: IsochroneMode;
    ranges: number[];
    featureCount: number;
    provider: string;
    canPersist: boolean;
  };
};

export type IsochroneApiError = Error & {
  status?: number;
  code?: string;
  retryAfterSeconds?: number | null;
};

const CLIENT_TIMEOUT_MS = 25_000;
const MAX_RESPONSE_CHARACTERS = 4 * 1024 * 1024;
const MODES = new Set<IsochroneMode>([
  "drive_traffic",
  "drive",
  "bicycle",
  "walk",
]);
const TYPES = new Set<IsochroneType>(["time", "distance"]);

function apiError(
  message: string,
  status: number,
  code: string,
  retryAfterSeconds: number | null = null,
) {
  const error = new Error(message) as IsochroneApiError;
  error.status = status;
  error.code = code;
  error.retryAfterSeconds = retryAfterSeconds;
  return error;
}

function retryAfterSeconds(response: Response, data: any) {
  const detailsValue = Number(
    data?.error?.details?.retryAfterSeconds,
  );
  const headerValue = Number(response.headers.get("retry-after"));
  const value = Number.isFinite(detailsValue) && detailsValue > 0
    ? detailsValue
    : headerValue;

  return Number.isFinite(value) && value > 0
    ? Math.ceil(value)
    : null;
}

async function readJson(response: Response) {
  const text = await response.text();

  if (text.length > MAX_RESPONSE_CHARACTERS) {
    throw apiError(
      "O serviço de isócronas retornou dados acima do limite permitido.",
      502,
      "ISOCHRONE_RESPONSE_TOO_LARGE",
    );
  }

  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw apiError(
      "O serviço de isócronas retornou uma resposta inválida.",
      response.status,
      "ISOCHRONE_INVALID_RESPONSE",
    );
  }
}

function normalizedMetadata(value: any): IsochroneResult["metadata"] {
  const type = value?.type;
  const mode = value?.mode;
  const ranges: number[] = Array.isArray(value?.ranges)
    ? value.ranges.map(Number)
    : [];
  const featureCount = Number(value?.featureCount);
  const provider =
    typeof value?.provider === "string"
      ? value.provider.trim()
      : "";

  if (
    !TYPES.has(type) ||
    !MODES.has(mode) ||
    !ranges.length ||
    ranges.some((range) => !Number.isFinite(range) || range <= 0) ||
    !Number.isInteger(featureCount) ||
    featureCount < 1 ||
    !provider ||
    typeof value?.canPersist !== "boolean"
  ) {
    throw apiError(
      "O serviço retornou metadados de isócrona inválidos.",
      502,
      "ISOCHRONE_METADATA_INVALID",
    );
  }

  return {
    type,
    mode,
    ranges,
    featureCount,
    provider,
    canPersist: value.canPersist,
  };
}

export function isIsochroneAbortError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      (error as IsochroneApiError).code === "ISOCHRONE_REQUEST_ABORTED")
  );
}

export function isochroneErrorMessage(error: unknown) {
  const api = error as IsochroneApiError;

  if (api?.code === "ISOCHRONE_RATE_LIMITED") {
    return api.retryAfterSeconds
      ? `Limite temporário atingido. Tente novamente em cerca de ${api.retryAfterSeconds} segundos.`
      : "Limite temporário atingido. Aguarde antes de tentar novamente.";
  }

  if (
    api?.code === "ISOCHRONE_PROVIDER_TIMEOUT" ||
    api?.code === "ISOCHRONE_CLIENT_TIMEOUT"
  ) {
    return "A análise demorou além do esperado. Tente novamente.";
  }

  if (
    api?.code === "ISOCHRONE_FEATURE_DISABLED" ||
    api?.code === "ISOCHRONE_PROVIDER_NOT_CONFIGURED"
  ) {
    return "A ferramenta de isócronas está indisponível neste ambiente.";
  }

  if (api?.status === 401) {
    return "Sua sessão expirou. Entre novamente para gerar a análise.";
  }

  if (api?.status === 403) {
    return "Você não possui permissão para gerar esta análise.";
  }

  if (api?.status && api.status >= 500) {
    return "O serviço de isócronas está temporariamente indisponível.";
  }

  if (
    error instanceof TypeError &&
    /fetch|network|load failed/i.test(error.message)
  ) {
    return "Não foi possível conectar ao serviço de isócronas.";
  }

  return error instanceof Error && error.message.trim()
    ? error.message
    : "Não foi possível gerar a análise.";
}

export async function requestIsochrone(
  input: IsochroneRequest,
  signal?: AbortSignal,
): Promise<IsochroneResult> {
  const controller = new AbortController();
  let timedOut = false;
  const handleAbort = () => controller.abort(signal?.reason);
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CLIENT_TIMEOUT_MS);

  signal?.addEventListener("abort", handleAbort, { once: true });

  try {
    const response = await fetch("/api/maps/isochrones", {
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
        data?.error?.message ||
          "Não foi possível gerar a isócrona agora.",
        response.status,
        data?.error?.code || "ISOCHRONE_REQUEST_FAILED",
        retryAfterSeconds(response, data),
      );
    }

    if (
      data.geojson?.type !== "FeatureCollection" ||
      !Array.isArray(data.geojson?.features)
    ) {
      throw apiError(
        "O serviço não retornou um GeoJSON válido.",
        502,
        "ISOCHRONE_GEOJSON_MISSING",
      );
    }

    return {
      geojson: data.geojson,
      metadata: normalizedMetadata(data.metadata),
    };
  } catch (error) {
    if (timedOut) {
      throw apiError(
        "A solicitação de isócrona excedeu o tempo limite.",
        504,
        "ISOCHRONE_CLIENT_TIMEOUT",
      );
    }

    if (signal?.aborted || isIsochroneAbortError(error)) {
      const aborted = apiError(
        "A solicitação de isócrona foi cancelada.",
        499,
        "ISOCHRONE_REQUEST_ABORTED",
      );
      aborted.name = "AbortError";
      throw aborted;
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", handleAbort);
  }
}
