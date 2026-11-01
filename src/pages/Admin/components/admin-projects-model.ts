export type AdminProject = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  organizationId?: number | null;
  organization?: { id: number; name?: string; slug?: string } | null;
  dropboxRootPath?: string;
  defaultConfigFile?: string;
  active?: boolean;
  accessCount?: number;
  lifecycle?: { state: string; version?: number; configRevision?: number } | null;
  metadataVersion?: number;
  createdBy?: { name?: string | null } | null;
  updatedBy?: { name?: string | null } | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ProjectOrganization = { id: number; name: string; active?: boolean };
export type ProjectFilters = { search: string; organization: string; lifecycle: string };
export const lifecycleLabels: Record<string, string> = {
  ACTIVE: "Ativo", DRAFT: "Rascunho", PREPARING_STORAGE: "Preparando armazenamento",
  CONFIG_READY: "Configuração pronta", FAILED: "Falhou", PENDING: "Pendente",
  LEGACY: "Legado (sem ciclo)", UNKNOWN: "Não informado",
};
export const filterKeys = ["projectSearch", "projectOrganization", "projectLifecycle", "projectPage", "projectPageSize"];

export function projectLifecycle(project: AdminProject) {
  if (project.lifecycle === null) return "LEGACY";
  return project.lifecycle?.state || "UNKNOWN";
}

export function readProjectQuery(params: URLSearchParams) {
  const number = (key: string, fallback: number) => {
    const value = Number(params.get(key));
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  };
  return {
    search: params.get("projectSearch") || "",
    organization: params.get("projectOrganization") || "all",
    lifecycle: params.get("projectLifecycle") || "all",
    page: number("projectPage", 1),
    pageSize: [10, 25, 50].includes(number("projectPageSize", 10)) ? number("projectPageSize", 10) : 10,
  };
}

export function filterProjects(projects: AdminProject[], filters: ProjectFilters) {
  const query = filters.search.trim().toLocaleLowerCase("pt-BR");
  return projects.filter(project => {
    const organizationId = project.organizationId ?? project.organization?.id;
    if (filters.organization !== "all" && String(organizationId ?? "none") !== filters.organization) return false;
    if (filters.lifecycle !== "all" && projectLifecycle(project) !== filters.lifecycle) return false;
    return !query || [project.name, project.slug, project.description, project.organization?.name, project.organization?.slug]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR").includes(query);
  });
}

export function paginateProjects<T>(items: T[], requestedPage: number, pageSize: number) {
  const size = [10, 25, 50].includes(pageSize) ? pageSize : 10;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(pages, Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1));
  return { items: items.slice((page - 1) * size, page * size), page, pages, start: items.length ? (page - 1) * size + 1 : 0, end: Math.min(page * size, items.length) };
}

/** Mirrors the publication/context prerequisites, never grants destination ACL. */
export function projectUnavailableReason(project: AdminProject, activeOrganizationId: string | number | null | undefined, organizations: ProjectOrganization[], organizationsAvailable: boolean) {
  if (!project.slug?.trim()) return "Slug não informado.";
  const state = projectLifecycle(project);
  if (state !== "ACTIVE" && !(state === "LEGACY" && project.active === true)) return "Mapa ainda não publicado ou indisponível.";
  const organizationId = project.organizationId ?? project.organization?.id;
  if (!organizationId) return "Organização não informada.";
  if (!organizationsAvailable) return "Disponibilidade da organização não confirmada.";
  const organization = organizations.find(item => item.id === organizationId);
  if (organization?.active !== true) return organization?.active === false ? "Organização inativa." : "Disponibilidade da organização não confirmada.";
  if (!activeOrganizationId || String(activeOrganizationId) !== String(organizationId)) return "Ative esta organização em Projetos para abrir o mapa.";
  return null;
}

export function formatAdminProjectDate(value?: string) {
  if (!value) return "Não informada";
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? "Não informada" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}
