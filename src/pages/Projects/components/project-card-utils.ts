import type { ProjectListItem } from "../projects-api";

export type NormalizedProjectAccessLevel =
  | "owner"
  | "editor"
  | "viewer"
  | "unknown";

export function normalizeProjectAccessLevel(
  value?: string | null,
): NormalizedProjectAccessLevel {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "client") {
    return "owner";
  }

  if (
    normalized === "owner" ||
    normalized === "editor" ||
    normalized === "viewer"
  ) {
    return normalized;
  }

  return "unknown";
}

export function projectAccessLabel(value?: string | null) {
  const normalized = normalizeProjectAccessLevel(value);

  const labels: Record<NormalizedProjectAccessLevel, string> = {
    owner: "Proprietário",
    editor: "Edição",
    viewer: "Visualização",
    unknown: "Acesso",
  };

  return labels[normalized];
}

export function parseProjectDate(value?: string | null) {
  const trimmed = String(value || "").trim();

  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(`${trimmed.replace(" ", "T")}Z`);
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return new Date(`${trimmed}Z`);
  }

  return new Date(trimmed);
}

function formatAbsoluteProjectDate(value?: string | null) {
  const date = parseProjectDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return String(value || "Não informado");
  }

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatProjectRelativeDate(value?: string | null) {
  if (!value) {
    return "Atualização não informada";
  }

  const date = parseProjectDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return `Atualizado em ${value}`;
  }

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMinutes < 1) return "Atualizado agora";
  if (diffMinutes < 60) return `Atualizado há ${diffMinutes} min`;
  if (diffHours < 24) return `Atualizado há ${diffHours} h`;
  if (diffDays < 30) {
    return `Atualizado há ${diffDays} dia${diffDays === 1 ? "" : "s"}`;
  }
  if (diffMonths < 12) {
    return `Atualizado há ${diffMonths} mês${diffMonths === 1 ? "" : "es"}`;
  }

  return `Atualizado em ${formatAbsoluteProjectDate(value)}`;
}

export function projectThumbnailUrl(project: ProjectListItem) {
  if (project.thumbnailUrl) {
    return project.thumbnailUrl;
  }

  const stableVersion =
    project.updatedAt || project.createdAt || project.slug;
  const cacheKey = encodeURIComponent(stableVersion);

  return `/api/projects/${encodeURIComponent(
    project.slug,
  )}/thumbnail?v=${cacheKey}`;
}

export function projectThumbnailKey(project: ProjectListItem) {
  return `${project.slug}::${projectThumbnailUrl(project)}`;
}
