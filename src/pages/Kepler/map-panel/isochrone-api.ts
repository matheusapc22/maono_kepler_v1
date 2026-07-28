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
  };
};

export type IsochroneApiError = Error & {
  status?: number;
  code?: string;
  retryAfterSeconds?: number | null;
};

async function readJson(response: Response) {
  const text = await response.text();

  if (!text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(
      "O serviço de isócronas retornou uma resposta inválida.",
    ) as IsochroneApiError;
    error.status = response.status;
    error.code = "ISOCHRONE_INVALID_RESPONSE";
    throw error;
  }
}

export async function requestIsochrone(
  input: IsochroneRequest,
  signal?: AbortSignal,
): Promise<IsochroneResult> {
  const response = await fetch("/api/maps/isochrones", {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    signal,
  });
  const data = await readJson(response);

  if (!response.ok || !data?.ok) {
    const error = new Error(
      data?.error?.message ||
        "Não foi possível gerar a isócrona agora.",
    ) as IsochroneApiError;
    error.status = response.status;
    error.code =
      data?.error?.code || "ISOCHRONE_REQUEST_FAILED";
    error.retryAfterSeconds =
      Number(data?.error?.details?.retryAfterSeconds) || null;
    throw error;
  }

  if (
    data.geojson?.type !== "FeatureCollection" ||
    !Array.isArray(data.geojson?.features)
  ) {
    const error = new Error(
      "O serviço não retornou um GeoJSON válido.",
    ) as IsochroneApiError;
    error.status = 502;
    error.code = "ISOCHRONE_GEOJSON_MISSING";
    throw error;
  }

  return {
    geojson: data.geojson,
    metadata: data.metadata,
  };
}
