import type {ProjectListItem} from './projects-api';

export function sameProject(
  project: ProjectListItem,
  updatedProject: ProjectListItem,
) {
  if (
    project.id !== null &&
    project.id !== undefined &&
    updatedProject.id !== null &&
    updatedProject.id !== undefined
  ) {
    return String(project.id) === String(updatedProject.id);
  }

  return project.slug === updatedProject.slug;
}

export function mergeProjectSnapshot(
  projects: ProjectListItem[],
  updatedProject: ProjectListItem,
) {
  return projects.map((project) => {
    if (!sameProject(project, updatedProject)) {
      return project;
    }

    const favorite =
      updatedProject.favorite ??
      updatedProject.favorited ??
      project.favorite ??
      project.favorited;

    return {
      ...project,
      ...updatedProject,
      favorite,
      favorited: favorite,
      thumbnailUrl:
        updatedProject.thumbnailUrl ??
        updatedProject.thumbnail_url ??
        project.thumbnailUrl ??
        project.thumbnail_url,
      thumbnail_url:
        updatedProject.thumbnail_url ??
        updatedProject.thumbnailUrl ??
        project.thumbnail_url ??
        project.thumbnailUrl,
      accessLevel:
        updatedProject.accessLevel ??
        updatedProject.access_level ??
        project.accessLevel,
      access_level:
        updatedProject.access_level ??
        updatedProject.accessLevel ??
        project.access_level ??
        project.accessLevel,
      permissions: updatedProject.permissions ?? project.permissions,
      deniedPermissions:
        updatedProject.deniedPermissions ?? project.deniedPermissions,
    };
  });
}
