import type { WorkspaceProject } from "./workspace-api";

export type ProjectThumbnailState = "loaded" | "missing";

export function projectThumbnailUrl(project: WorkspaceProject) {
  if (project.thumbnailUrl) {
    return project.thumbnailUrl;
  }

  const stableVersion = project.updatedAt || project.createdAt || project.slug;
  const cacheKey = encodeURIComponent(stableVersion);
  return `/api/projects/${encodeURIComponent(project.slug)}/thumbnail?v=${cacheKey}`;
}
