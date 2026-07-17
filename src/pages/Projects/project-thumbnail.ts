import type { WorkspaceProject } from "./workspace-api";

export type ProjectThumbnailState = "loaded" | "missing";
export type ProjectThumbnailStates = Record<string, ProjectThumbnailState>;

const THUMBNAIL_TIMEOUT_MS = 15000;

export function projectThumbnailUrl(project: WorkspaceProject) {
  if (project.thumbnailUrl) {
    return project.thumbnailUrl;
  }

  const stableVersion = project.updatedAt || project.createdAt || project.slug;
  const cacheKey = encodeURIComponent(stableVersion);
  return `/api/projects/${encodeURIComponent(project.slug)}/thumbnail?v=${cacheKey}`;
}

function preloadImage(
  source: string,
  timeoutMs: number,
): Promise<ProjectThumbnailState> {
  if (typeof window === "undefined" || typeof window.Image === "undefined") {
    return Promise.resolve("loaded");
  }

  return new Promise((resolve) => {
    const image = new window.Image();
    let settled = false;

    const finish = (state: ProjectThumbnailState) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      image.onload = null;
      image.onerror = null;
      resolve(state);
    };

    const finishLoaded = async () => {
      try {
        if (typeof image.decode === "function") {
          await image.decode();
        }
      } catch {
        // A imagem já foi carregada; falha de decode não impede sua exibição.
      }

      finish("loaded");
    };

    const timeoutId = window.setTimeout(
      () => finish("missing"),
      Math.max(1000, timeoutMs),
    );

    image.onload = () => {
      void finishLoaded();
    };
    image.onerror = () => finish("missing");
    image.decoding = "async";
    image.src = source;

    if (image.complete) {
      if (image.naturalWidth > 0) {
        void finishLoaded();
      } else {
        finish("missing");
      }
    }
  });
}

export async function preloadProjectThumbnails(
  projects: WorkspaceProject[],
  timeoutMs = THUMBNAIL_TIMEOUT_MS,
): Promise<ProjectThumbnailStates> {
  const entries = await Promise.all(
    projects.map(async (project) => {
      const state = await preloadImage(projectThumbnailUrl(project), timeoutMs);
      return [project.slug, state] as const;
    }),
  );

  return Object.fromEntries(entries);
}
