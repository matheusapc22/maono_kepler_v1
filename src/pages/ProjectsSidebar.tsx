import React, { useMemo, useState } from "react";
import { Link } from "react-router";

import {
  can,
  type AccessControlUser,
  type PermissionContext,
} from "../access-control/can";
import { PERMISSION, type Permission } from "../access-control/permissions";
import Logo from "../assets/images/Logo_Maono.png";
import type {
  MaonoId,
  MaonoOrganization,
  MaonoUser,
} from "../auth/session";
import OrganizationWorkspaceSwitcher from "./Projects/components/OrganizationWorkspaceSwitcher";
import HeadsetIcon from "../components/icons/HeadsetIcon";

export type ProjectSidebarSection =
  | "all"
  | "recent"
  | "favorites"
  | "files"
  | "requests"
  | "exports"
  | "users"
  | "organization"
  | "limits"
  | "audit"
  | "backend";

type ProjectsSidebarProps = {
  user: MaonoUser | null;
  activeOrganization: MaonoOrganization | null;
  organizations: MaonoOrganization[];
  switchingOrganization: boolean;
  organizationSwitchError: string | null;
  activeProjectsCount: number;
  searchQuery: string;
  sidebarSection: ProjectSidebarSection;
  onSearchQueryChange: (value: string) => void;
  onSidebarSectionChange: (section: ProjectSidebarSection) => void;
  onOrganizationSwitch: (organizationId: MaonoId) => Promise<void>;
  onDismissOrganizationSwitchError: () => void;
  onLogout: () => void | Promise<void>;
};

type SidebarUser = MaonoUser &
  AccessControlUser & {
    activeOrganization?: PermissionContext["organization"] | null;
    organization?: PermissionContext["organization"] | null;
  };

type SidebarItem = {
  key?: ProjectSidebarSection;
  label: string;
  icon: React.ReactNode;
  count?: number;
  href?: string;
  permission?: Permission;
};

type SidebarGroup = {
  title: string;
  items: SidebarItem[];
};

const MAONO_SYMBOL_SRC = "/images/Simbolo_Maono.png";

const MANAGEMENT_SECTIONS = new Set<ProjectSidebarSection>([
  "users",
  "organization",
  "limits",
]);

const MANAGEMENT_PERMISSIONS = new Set<Permission>([
  PERMISSION.USERS_VIEW,
  PERMISSION.ORGANIZATION_VIEW,
  PERMISSION.LIMITS_VIEW,
]);

const ADMINISTRATION_PERMISSIONS = new Set<Permission>([
  PERMISSION.ADMIN_PANEL_ACCESS,
  PERMISSION.AUDIT_VIEW,
]);

function getInitials(nameOrEmail?: string) {
  const value = String(nameOrEmail || "M").trim();
  const [first = "M", second = ""] = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function normalizeRole(role?: string) {
  return String(role || "").trim().toLowerCase();
}

function normalizeRoleLabel(role?: string) {
  const normalized = normalizeRole(role);

  if (normalized === "super_admin") return "Super Admin";
  if (normalized === "admin") return "Admin";
  if (normalized === "owner" || normalized === "client") return "Owner";
  if (normalized === "editor") return "Editor";
  if (normalized === "viewer") return "Viewer";

  return role || "Usuário";
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isSuperAdmin(user: MaonoUser | null) {
  return normalizeRole(user?.role) === "super_admin";
}

function isOwner(user: MaonoUser | null) {
  const role = normalizeRole(user?.role);

  return role === "owner" || role === "client";
}

function hasPlatformScope(user: MaonoUser | null) {
  const scopes = getStringArray((user as SidebarUser | null)?.scopes);

  return scopes.includes("platform:*");
}

function hasExplicitPermission(
  user: MaonoUser | null,
  permission: Permission,
) {
  const permissions = getStringArray(
    (user as SidebarUser | null)?.permissions,
  );

  return permissions.includes(permission);
}

function buildPermissionContext(user: MaonoUser | null): PermissionContext {
  if (!user) {
    return {};
  }

  const sidebarUser = user as SidebarUser;

  const organization =
    sidebarUser.activeOrganization ?? sidebarUser.organization ?? undefined;

  const organizationId =
    sidebarUser.activeOrganizationId ??
    sidebarUser.organizationId ??
    sidebarUser.organization_id ??
    sidebarUser.activeOrganization?.id ??
    sidebarUser.activeOrganization?.organizationId ??
    sidebarUser.organization?.id ??
    sidebarUser.organization?.organizationId ??
    undefined;

  return {
    organizationId,
    organization,
    permissions: sidebarUser.permissions,
    scopes: sidebarUser.scopes,
  };
}

function hasOrganizationScope(context: PermissionContext) {
  return Boolean(
    context.organizationId ??
      context.organization?.id ??
      context.organization?.organizationId,
  );
}

function canShowManagementItem(
  user: MaonoUser | null,
  item: SidebarItem,
  context: PermissionContext,
) {
  if (!user || !item.permission || !item.key) {
    return false;
  }

  if (!MANAGEMENT_SECTIONS.has(item.key)) {
    return false;
  }

  if (!MANAGEMENT_PERMISSIONS.has(item.permission)) {
    return false;
  }

  if (isSuperAdmin(user) || hasPlatformScope(user)) {
    return true;
  }

  if (hasExplicitPermission(user, item.permission)) {
    return can(user as AccessControlUser, item.permission, context);
  }

  /**
   * Owner pode ver Gestão da própria organização.
   * Ainda assim exigimos organizationId no contexto para evitar mostrar Gestão
   * quando a sessão não carrega organização ativa.
   */
  if (isOwner(user) && hasOrganizationScope(context)) {
    return can(user as AccessControlUser, item.permission, context);
  }

  /**
   * Admin autorizado depende do can(...), que valida escopo/permissão.
   * Viewer/Editor sem permissão explícita também caem aqui e devem retornar false.
   */
  return can(user as AccessControlUser, item.permission, context);
}

function isAdministrationItem(item: SidebarItem) {
  return Boolean(
    item.permission && ADMINISTRATION_PERMISSIONS.has(item.permission),
  );
}

function canShowAdministrationItem(
  user: MaonoUser | null,
  item: SidebarItem,
  context: PermissionContext,
) {
  if (!user || !item.permission) {
    return false;
  }

  if (!isAdministrationItem(item)) {
    return false;
  }

  /**
   * Não duplicamos regra sensível aqui.
   * A sidebar pergunta ao can.ts se o item pode aparecer visualmente:
   * - Painel Admin depende de admin.panel.access.
   * - Auditoria depende de audit.view.
   *
   * Segurança real continua nas rotas e endpoints.
   */
  return can(user as AccessControlUser, item.permission, context);
}

function canShowItem(
  user: MaonoUser | null,
  item: SidebarItem,
  context: PermissionContext,
) {
  if (!user) {
    return false;
  }

  if (!item.permission) {
    return true;
  }

  if (item.key && MANAGEMENT_SECTIONS.has(item.key)) {
    return canShowManagementItem(user, item, context);
  }

  if (isAdministrationItem(item)) {
    return canShowAdministrationItem(user, item, context);
  }

  return can(user as AccessControlUser, item.permission, context);
}

function createSidebarGroups(activeProjectsCount: number): SidebarGroup[] {
  return [
    {
      title: "Projetos",
      items: [
        {
          key: "all",
          label: "Todos os Projetos",
          icon: "▦",
          count: activeProjectsCount,
        },
        {
          key: "recent",
          label: "Recentes",
          icon: "◷",
        },
        {
          key: "favorites",
          label: "Favoritos",
          icon: "☆",
        },
      ],
    },
    {
      title: "Organização",
      items: [
        {
          key: "files",
          label: "Arquivos e Documentos",
          icon: "▤",
          permission: PERMISSION.DOCUMENT_VIEW,
        },
        {
          key: "requests",
          label: "Central de Chamados",
          icon: <HeadsetIcon className="mm-sidebar-headset" />,
          permission: PERMISSION.TICKET_VIEW,
        },
        {
          key: "exports",
          label: "Exportações",
          icon: "⇩",
          permission: PERMISSION.EXPORT_VIEW,
        },
      ],
    },
    {
      title: "Gestão",
      items: [
        {
          key: "users",
          label: "Usuários e Acessos",
          icon: "☷",
          permission: PERMISSION.USERS_VIEW,
        },
        {
          key: "organization",
          label: "Organização",
          icon: "▥",
          permission: PERMISSION.ORGANIZATION_VIEW,
        },
        {
          key: "limits",
          label: "Limites e Planos",
          icon: "▧",
          permission: PERMISSION.LIMITS_VIEW,
        },
      ],
    },
    {
      title: "Administração Maõno",
      items: [
        {
          label: "Painel Admin",
          icon: "♛",
          href: "/admin",
          permission: PERMISSION.ADMIN_PANEL_ACCESS,
        },
        {
          key: "audit",
          label: "Auditoria",
          icon: "◌",
          permission: PERMISSION.AUDIT_VIEW,
        },
      ],
    },
  ];
}

function SectionTitle({
  children,
  expanded,
}: {
  children: React.ReactNode;
  expanded: boolean;
}) {
  if (!expanded) {
    return <div className="mm-sidebar-divider" aria-hidden="true" />;
  }

  return <div className="mm-sidebar-title">{children}</div>;
}

function ItemButton({
  item,
  active,
  onClick,
}: {
  item: SidebarItem;
  active?: boolean;
  onClick?: () => void;
}) {
  const className = active ? "mm-sidebar-item active" : "mm-sidebar-item";

  const content = (
    <>
      <span className="mm-sidebar-icon" aria-hidden="true">
        {item.icon}
      </span>

      <span className="mm-sidebar-label">{item.label}</span>

      {typeof item.count === "number" ? (
        <span className="mm-sidebar-count">{item.count}</span>
      ) : null}
    </>
  );

  if (item.href) {
    return (
      <Link
        to={item.href}
        className={className}
        title={item.label}
        aria-label={item.label}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      title={item.label}
      aria-label={item.label}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

const ProjectsSidebar: React.FC<ProjectsSidebarProps> = ({
  user,
  activeOrganization,
  organizations,
  switchingOrganization,
  organizationSwitchError,
  activeProjectsCount,
  searchQuery,
  sidebarSection,
  onSearchQueryChange,
  onSidebarSectionChange,
  onOrganizationSwitch,
  onDismissOrganizationSwitchError,
  onLogout,
}) => {
  const [expanded, setExpanded] = useState(true);

  const permissionContext = useMemo(
    () => buildPermissionContext(user),
    [user],
  );

  const groups = useMemo(() => {
    return createSidebarGroups(activeProjectsCount)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          canShowItem(user, item, permissionContext),
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [activeProjectsCount, permissionContext, user]);

  return (
    <aside
      className={[
        "mm-projects-sidebar",
        expanded ? "" : "collapsed",
        switchingOrganization ? "is-context-switching" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label="Navegação da área de projetos"
      aria-busy={switchingOrganization}
    >
      <div className="mm-sidebar-head">
        <div className="mm-sidebar-brand-row">
          <div className="mm-sidebar-logo-mask">
            <img
              src={expanded ? Logo : MAONO_SYMBOL_SRC}
              alt="Maõno"
              className="mm-sidebar-logo"
            />
          </div>

          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mm-sidebar-toggle"
            title={expanded ? "Recolher sidebar" : "Expandir sidebar"}
            aria-label={expanded ? "Recolher sidebar" : "Expandir sidebar"}
            aria-expanded={expanded}
          >
            {expanded ? "‹" : "›"}
          </button>
        </div>

        {expanded ? (
          <div className="mm-sidebar-user">
            <div className="mm-sidebar-avatar" aria-hidden="true">
              {getInitials(user?.name || user?.email)}
            </div>

            <div className="mm-sidebar-user-copy">
              <strong>{user?.name || "Usuário Maõno"}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
        ) : null}

        {expanded ? (
          <div className="mm-sidebar-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Buscar"
              aria-label="Buscar projetos"
            />
          </div>
        ) : null}

        <OrganizationWorkspaceSwitcher
          activeOrganization={activeOrganization}
          organizations={organizations}
          expanded={expanded}
          switching={switchingOrganization}
          error={organizationSwitchError}
          onSwitch={onOrganizationSwitch}
          onDismissError={onDismissOrganizationSwitchError}
        />
      </div>

      <nav className="mm-sidebar-nav" aria-label="Navegação da área de projetos">
        {groups.map((group) => (
          <div key={group.title} className="mm-sidebar-group">
            <SectionTitle expanded={expanded}>{group.title}</SectionTitle>

            <div className="mm-sidebar-items">
              {group.items.map((item) => {
                const section = item.key;

                return (
                  <ItemButton
                    key={item.href || section || item.label}
                    item={item}
                    active={section === sidebarSection}
                    onClick={
                      section
                        ? () => onSidebarSectionChange(section)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="mm-sidebar-footer">
        {expanded ? (
          <>
            <strong>Maõno Maps</strong>
            <span>{normalizeRoleLabel(user?.role)} · central geográfica</span>
          </>
        ) : null}

        <button
          type="button"
          className={expanded ? undefined : "mm-sidebar-item"}
          title="Sair"
          aria-label="Sair"
          onClick={() => {
            void onLogout();
          }}
        >
          {expanded ? (
            "Sair"
          ) : (
            <>
              <span className="mm-sidebar-icon" aria-hidden="true">
                ⎋
              </span>
              <span className="mm-sidebar-label">Sair</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
};

export default ProjectsSidebar;
