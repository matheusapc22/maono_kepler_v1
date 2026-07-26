import type {
  MaonoId,
  MaonoProject,
  ProjectActor,
} from "../../auth/session";

export type ProjectSectionKey = "all" | "recent" | "favorites";

export type ProjectThumbnailStatus =
  | "UNKNOWN"
  | "PENDING"
  | "READY"
  | "FAILED"
  | "MISSING";

export type ProjectListItem = MaonoProject & {
  favorite?: boolean;
  favorited?: boolean;
  thumbnailUrl?: string;
  thumbnailStatus?: ProjectThumbnailStatus;
  configRevision?: number;
  thumbnailRevision?: number | null;
  thumbnailUpdatedAt?: string | null;
  thumbnailAttempts?: number;
};

export type ProjectMetadata = ProjectListItem & {
  organization?: {
    id: MaonoId | null;
    name: string;
    slug?: string | null;
  } | null;
  createdBy?: ProjectActor | null;
  updatedBy?: ProjectActor | null;
  metadataVersion: number;
};

export type UpdateProjectMetadataInput = {
  name: string;
  description: string;
  metadataVersion: number;
};

type ApiErrorPayload = {
  ok?: boolean;
  error?: {
    code?: string;
    message?: string;
    details?: {
      currentProject?: ProjectMetadata | null;
      [key: string]: unknown;
    } | null;
  };
};

type ProjectsResponse = ApiErrorPayload & {
  projects?: ProjectListItem[];
};

type FavoriteResponse = ApiErrorPayload & {
  project?: ProjectListItem;
};

type ProjectMetadataResponse = ApiErrorPayload & {
  project?: ProjectMetadata;
};

type ProjectThumbnailStatusResponse = ApiErrorPayload & {
  thumbnailStatus?: ProjectThumbnailStatus;
  configRevision?: number;
  thumbnailRevision?: number | null;
  thumbnailUpdatedAt?: string | null;
  thumbnailAttempts?: number;
};

export class ProjectMetadataApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly currentProject: ProjectMetadata | null;

  constructor({
    message,
    status,
    code,
    currentProject = null,
  }: {
    message: string;
    status: number;
    code?: string;
    currentProject?: ProjectMetadata | null;
  }) {
    super(message);
    this.name = "ProjectMetadataApiError";
    this.status = status;
    this.code = code || "PROJECT_METADATA_ERROR";
    this.currentProject = currentProject;
  }
}

function endpointForSection(section: ProjectSectionKey) {
  if (section === "recent") {
    return "/api/projects/recent";
  }

  if (section === "favorites") {
    return "/api/projects/favorites";
  }

  return "/api/projects";
}

function metadataEndpoint(slug: string) {
  return `/api/projects/${encodeURIComponent(slug)}/metadata`;
}

export async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      response.ok
        ? "A resposta da API não está em JSON válido."
        : text.slice(0, 500),
    );
  }
}

export function errorMessage(data: unknown, fallback: string) {
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    data.error &&
    typeof data.error === "object" &&
    "message" in data.error &&
    typeof data.error.message === "string"
  ) {
    return data.error.message;
  }

  return fallback;
}

function errorCode(data: ApiErrorPayload, fallback: string) {
  return data.error?.code || fallback;
}

function projectMetadataErrorFromResponse(
  response: Response,
  data: ProjectMetadataResponse,
  fallback: string,
) {
  const currentProject =
    response.status === 409
      ? data.error?.details?.currentProject ?? null
      : null;

  return new ProjectMetadataApiError({
    message: errorMessage(data, fallback),
    status: response.status,
    code: errorCode(data, "PROJECT_METADATA_ERROR"),
    currentProject,
  });
}

export async function fetchProjects(
  section: ProjectSectionKey = "all",
  options: { signal?: AbortSignal } = {},
): Promise<ProjectListItem[]> {
  const response = await fetch(endpointForSection(section), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    signal: options.signal,
  });

  const data = await readJsonResponse<ProjectsResponse>(response);

  if (!response.ok) {
    throw new Error(errorMessage(data, "Não foi possível carregar projetos."));
  }

  return Array.isArray(data.projects) ? data.projects : [];
}

export async function fetchProjectThumbnailStatus(
  slug: string,
  options: { signal?: AbortSignal } = {},
) {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/thumbnail/status`,
    {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
      signal: options.signal,
    },
  );
  const data =
    await readJsonResponse<ProjectThumbnailStatusResponse>(response);

  if (!response.ok) {
    throw new Error(
      errorMessage(
        data,
        "Não foi possível consultar a visualização do projeto.",
      ),
    );
  }

  return {
    thumbnailStatus: data.thumbnailStatus || "UNKNOWN",
    configRevision: Math.max(0, Number(data.configRevision || 0)),
    thumbnailRevision:
      data.thumbnailRevision === null ||
      data.thumbnailRevision === undefined
        ? null
        : Math.max(0, Number(data.thumbnailRevision || 0)),
    thumbnailUpdatedAt: data.thumbnailUpdatedAt ?? null,
    thumbnailAttempts: Math.max(
      0,
      Number(data.thumbnailAttempts || 0),
    ),
  };
}

export async function setProjectFavorite(
  slug: string,
  favorite: boolean,
): Promise<ProjectListItem> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(slug)}/favorite`,
    {
      method: favorite ? "POST" : "DELETE",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    },
  );

  const data = await readJsonResponse<FavoriteResponse>(response);

  if (!response.ok) {
    throw new Error(errorMessage(data, "Não foi possível atualizar favorito."));
  }

  if (!data.project) {
    throw new Error("A API não retornou o projeto atualizado.");
  }

  return data.project;
}

export async function fetchProjectMetadata(
  slug: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectMetadata> {
  const response = await fetch(metadataEndpoint(slug), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    signal: options.signal,
  });

  const data = await readJsonResponse<ProjectMetadataResponse>(response);

  if (!response.ok) {
    throw projectMetadataErrorFromResponse(
      response,
      data,
      "Não foi possível carregar as informações do projeto.",
    );
  }

  if (!data.project) {
    throw new ProjectMetadataApiError({
      message: "A API não retornou os metadados do projeto.",
      status: response.status,
      code: "PROJECT_METADATA_RESPONSE_INVALID",
    });
  }

  return data.project;
}

export async function updateProjectMetadata(
  slug: string,
  input: UpdateProjectMetadataInput,
): Promise<ProjectMetadata> {
  const payload: UpdateProjectMetadataInput = {
    name: input.name,
    description: input.description,
    metadataVersion: input.metadataVersion,
  };

  const response = await fetch(metadataEndpoint(slug), {
    method: "PATCH",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await readJsonResponse<ProjectMetadataResponse>(response);

  if (!response.ok) {
    throw projectMetadataErrorFromResponse(
      response,
      data,
      response.status === 409
        ? "Este projeto foi alterado por outra pessoa."
        : "Não foi possível atualizar as informações do projeto.",
    );
  }

  if (!data.project) {
    throw new ProjectMetadataApiError({
      message: "A API não retornou o projeto atualizado.",
      status: response.status,
      code: "PROJECT_METADATA_RESPONSE_INVALID",
    });
  }

  return data.project;
}
