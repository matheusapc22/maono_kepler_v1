import type { ProjectListItem } from "../projects-api";
import { parseProjectDate } from "./project-card-utils";

export const PROJECT_PAGE_COPY = {
  all: { title: "Todos os Projetos", description: "Visualize e gerencie todos os seus projetos.", icon: "idea", empty: "Nenhum projeto encontrado." },
  recent: { title: "Recentes", description: "Veja os projetos acessados ou atualizados recentemente.", icon: "clock", empty: "Nenhum projeto recente." },
  favorites: { title: "Favoritos", description: "Encontre rapidamente seus projetos favoritos.", icon: "star", empty: "Nenhum projeto favorito." },
} as const;

export type ProjectStatusFilter = "all" | "active" | "inactive";
export type ProjectSortOrder = "recent" | "oldest";
export type ProjectPageFilters = {
  search: string;
  status: ProjectStatusFilter;
  order: ProjectSortOrder;
};

export const DEFAULT_PROJECT_FILTERS: ProjectPageFilters = {
  search: "", status: "all", order: "recent",
};

/** Search keeps the existing sidebar's searchable fields. No permissions or
 * section membership are inferred here: the server supplies that complete set. */
export function filterAndSortProjects(
  projects: ProjectListItem[],
  filters: ProjectPageFilters,
): ProjectListItem[] {
  const query = filters.search.trim().toLocaleLowerCase("pt-BR");
  const dateValue = (project: ProjectListItem) => {
    const value = parseProjectDate(project.updatedAt || project.createdAt)?.getTime();
    return value !== undefined && Number.isFinite(value) ? value : null;
  };
  return projects.filter(project => {
    const active = project.active !== false;
    if (filters.status === "active" && !active) return false;
    if (filters.status === "inactive" && active) return false;
    if (!query) return true;
    return [project.name, project.slug, project.description, project.accessLevel,
      project.organizationId, project.organization_id]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(query);
  }).sort((left, right) => {
    const a = dateValue(left); const b = dateValue(right);
    // Unknown dates remain at the end in either direction.
    if (a === null && b !== null) return 1;
    if (b === null && a !== null) return -1;
    const difference = a !== null && b !== null ? a - b : 0;
    return difference * (filters.order === "oldest" ? 1 : -1) ||
      left.name.localeCompare(right.name, "pt-BR") ||
      left.slug.localeCompare(right.slug, "pt-BR");
  });
}

/** Always clamp before slicing, including optimistic removal of the last item. */
export function projectPage<T>(projects: T[], requestedPage: number, pageSize: number) {
  const size = [10, 20, 50].includes(pageSize) ? pageSize : 10;
  const total = projects.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const page = Math.max(1, Math.min(pageCount, Math.floor(requestedPage) || 1));
  return { items: projects.slice((page - 1) * size, page * size), total, page, pageCount, pageSize: size };
}
