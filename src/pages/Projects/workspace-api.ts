import type { MaonoProject } from "../../auth/session";

export type WorkspaceSectionKey = "all" | "recent" | "favorites";

export type WorkspaceProject = MaonoProject & {
  favorite?: boolean;
  favorited?: boolean;
  thumbnailUrl?: string;
};

type ProjectsResponse = {
  ok?: boolean;
  projects?: WorkspaceProject[];
  error?: {
    message?: string;
  };
};

type FavoriteResponse = {
  ok?: boolean;
  project?: WorkspaceProject;
  error?: {
    message?: string;
  };
};

function endpointForSection(section: WorkspaceSectionKey) {
  if (section === "recent") {
    return "/api/projects/recent";
  }

  if (section === "favorites") {
    return "/api/projects/favorites";
  }

  return "/api/projects";
}

async function readJsonResponse<T>(response: Response): Promise<T> {
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

function errorMessage(data: unknown, fallback: string) {
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

export async function fetchWorkspaceProjects(
  section: WorkspaceSectionKey = "all",
): Promise<WorkspaceProject[]> {
  const response = await fetch(endpointForSection(section), {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
  });

  const data = await readJsonResponse<ProjectsResponse>(response);

  if (!response.ok) {
    throw new Error(errorMessage(data, "Não foi possível carregar projetos."));
  }

  return Array.isArray(data.projects) ? data.projects : [];
}

export async function setProjectFavorite(
  slug: string,
  favorite: boolean,
): Promise<WorkspaceProject> {
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
