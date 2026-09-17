import type {
  MaonoId,
  MaonoProject,
  ProjectActor,
} from "../../auth/session";
import { ApiError } from "../../lib/error-contract";
import {
  buildClientApiError,
  requestJson,
} from "../../lib/api-transport";

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

type ProjectsResponse = {
  projects?: ProjectListItem[];
};

type FavoriteResponse = {
  project?: ProjectListItem;
};

type ProjectMetadataResponse = {
  project?: ProjectMetadata;
};

type ProjectThumbnailStatusResponse = {
  thumbnailStatus?: ProjectThumbnailStatus;
  configRevision?: number;
  thumbnailRevision?: number | null;
  thumbnailUpdatedAt?: string | null;
  thumbnailAttempts?: number;
};

export class ProjectMetadataApiError extends ApiError {
  readonly currentProject: ProjectMetadata | null;

  constructor(baseError: ApiError, currentProject: ProjectMetadata | null = null) {
    super(
      {
        status: baseError.status,
        code: baseError.code,
        category: baseError.category,
        retryable: baseError.retryable,
        correlationId: baseError.correlationId,
        details: baseError.details,
      },
      baseError.payload,
      baseError.message,
    );
    this.name = "ProjectMetadataApiError";
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

function invalidProjectResponse() {
  return buildClientApiError({
    status: 502,
    code: "INFRASTRUCTURE_UNEXPECTED_ERROR",
    category: "INFRASTRUCTURE",
    retryable: true,
  });
}

function currentProjectFromError(apiError: ApiError): ProjectMetadata | null {
  if (apiError.status !== 409) {
    return null;
  }

  const details = apiError.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  const currentProject = (details as Record<string, unknown>).currentProject;
  return currentProject && typeof currentProject === "object"
    ? (currentProject as ProjectMetadata)
    : null;
}

function asMetadataError(apiError: ApiError) {
  return new ProjectMetadataApiError(
    apiError,
    currentProjectFromError(apiError),
  );
}

async function requestProjectMetadata(
  slug: string,
  init: RequestInit,
): Promise<ProjectMetadata> {
  try {
    const data = await requestJson<ProjectMetadataResponse>(
      metadataEndpoint(slug),
      init,
    );

    if (!data.project) {
      throw asMetadataError(invalidProjectResponse());
    }

    return data.project;
  } catch (error) {
    if (error instanceof ProjectMetadataApiError) {
      throw error;
    }

    if (error instanceof ApiError) {
      throw asMetadataError(error);
    }

    throw error;
  }
}

export async function fetchProjects(
  section: ProjectSectionKey = "all",
  options: { signal?: AbortSignal } = {},
): Promise<ProjectListItem[]> {
  const data = await requestJson<ProjectsResponse>(endpointForSection(section), {
    method: "GET",
    signal: options.signal,
  });

  return Array.isArray(data.projects) ? data.projects : [];
}

export async function fetchProjectThumbnailStatus(
  slug: string,
  options: { signal?: AbortSignal } = {},
) {
  const data = await requestJson<ProjectThumbnailStatusResponse>(
    `/api/projects/${encodeURIComponent(slug)}/thumbnail/status`,
    {
      method: "GET",
      signal: options.signal,
    },
  );

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
  const data = await requestJson<FavoriteResponse>(
    `/api/projects/${encodeURIComponent(slug)}/favorite`,
    {
      method: favorite ? "POST" : "DELETE",
    },
  );

  if (!data.project) {
    throw invalidProjectResponse();
  }

  return data.project;
}

export function fetchProjectMetadata(
  slug: string,
  options: { signal?: AbortSignal } = {},
): Promise<ProjectMetadata> {
  return requestProjectMetadata(slug, {
    method: "GET",
    signal: options.signal,
  });
}

export function updateProjectMetadata(
  slug: string,
  input: UpdateProjectMetadataInput,
): Promise<ProjectMetadata> {
  const payload: UpdateProjectMetadataInput = {
    name: input.name,
    description: input.description,
    metadataVersion: input.metadataVersion,
  };

  return requestProjectMetadata(slug, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
