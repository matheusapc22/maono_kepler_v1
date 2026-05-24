const LEGACY_ADMIN_USER = "adminma426o123no321";

const EDITABLE_PROJECT_ACCESS_LEVELS = new Set(["editor", "owner"]);

type MaonoSessionProject = {
  slug?: string;
  accessLevel?: string;
};

type MaonoSession = {
  authenticated?: boolean;
  user?: {
    role?: string;
  } | null;
  projects?: MaonoSessionProject[];
} | null;

type CheckAdminUserOptions = {
  session?: MaonoSession;
  projectSlug?: string | null;
};

function normalize(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function hasLegacyAdminSecret() {
  const queryString = window.location.search;
  const params = new URLSearchParams(queryString);
  const adminUserParameter = params.get("user");
  return adminUserParameter === LEGACY_ADMIN_USER;
}

function canEditProject(session: MaonoSession, projectSlug?: string | null) {
  const normalizedProjectSlug = normalize(projectSlug);

  if (!normalizedProjectSlug || !Array.isArray(session?.projects)) {
    return false;
  }

  const project = session.projects.find(
    (item) => normalize(item.slug) === normalizedProjectSlug
  );

  return EDITABLE_PROJECT_ACCESS_LEVELS.has(normalize(project?.accessLevel));
}

const checkAdminUser = (options: CheckAdminUserOptions = {}): boolean => {
  const session = options.session ?? window.__MAONO_SESSION__;

  if (session?.authenticated && session.user) {
    if (normalize(session.user.role) === "admin") {
      return true;
    }

    return canEditProject(session, options.projectSlug);
  }

  // Compatibilidade com links antigos e pré-visualizações sem sessão carregada.
  // Quando há sessão real, o segredo da URL NÃO libera viewer nem owner.
  return hasLegacyAdminSecret();
};

export default checkAdminUser;
