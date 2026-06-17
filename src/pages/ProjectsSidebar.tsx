import React, { useMemo, useState } from "react";
import { Link } from "react-router";

import {
  can,
  type AccessControlUser,
  type PermissionContext,
} from "../access-control/can";
import type { Permission } from "../access-control/permissions";
import Logo from "../assets/images/Logo_Maono.png";
import type { MaonoUser } from "../auth/session";

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
  activeProjectsCount: number;
  searchQuery: string;
  sidebarSection: ProjectSidebarSection;
  onSearchQueryChange: (value: string) => void;
  onSidebarSectionChange: (section: ProjectSidebarSection) => void;
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
  icon: string;
  count?: number;
  href?: string;
  permission?: Permission;
};

type SidebarGroup = {
  title: string;
  items: SidebarItem[];
};

const MAONO_SYMBOL_SRC = "/images/Simbolo_Maono.png";

function getInitials(nameOrEmail?: string) {
  const value = String(nameOrEmail || "M").trim();
  const [first = "M", second = ""] = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/);

  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function normalizeRoleLabel(role?: string) {
  const normalized = String(role || "").trim().toLowerCase();

  if (normalized === "super_admin") return "Super Admin";
  if (normalized === "admin") return "Admin";
  if (normalized === "owner" || normalized === "client") return "Owner";
  if (normalized === "editor") return "Editor";
  if (normalized === "viewer") return "Viewer";

  return role || "Usuário";
}

function buildPermissionContext(user: MaonoUser | null): PermissionContext {
  if (!user) {
    return {};
  }

  const sidebarUser = user as SidebarUser;

  const organizationId =
    sidebarUser.activeOrganizationId ??
    sidebarUser.organizationId ??
    sidebarUser.organization_id ??
    sidebarUser.activeOrganization?.id ??
    sidebarUser.organization?.id ??
    undefined;

  return {
    organizationId,
    organization:
      sidebarUser.activeOrganization ?? sidebarUser.organization ?? undefined,
    permissions: sidebarUser.permissions,
    scopes: sidebarUser.scopes,
  };
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

  return can(user as AccessControlUser, item.permission, context);
}

function createSidebarGroups(activeProjectsCount: number): SidebarGroup[] {
  return [
    {
      title: "Workspace",
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
          permission: "document.view",
        },
        {
          key: "requests",
          label: "Central de Chamados",
          icon: "◇",
          permission: "ticket.view",
        },
        {
          key: "exports",
          label: "Exportações",
          icon: "⇩",
          permission: "export.view",
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
          permission: "users.view",
        },
        {
          key: "organization",
          label: "Organização",
          icon: "▥",
          permission: "organization.view",
        },
        {
          key: "limits",
          label: "Limites e Planos",
          icon: "▧",
          permission: "limits.view",
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
          permission: "admin.panel.access",
        },
        {
          key: "audit",
          label: "Auditoria",
          icon: "◌",
          permission: "audit.view",
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

      {typeof item.count === "number" && (
        <span className="mm-sidebar-count">{item.count}</span>
      )}
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
  activeProjectsCount,
  searchQuery,
  sidebarSection,
  onSearchQueryChange,
  onSidebarSectionChange,
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
      className={
        expanded ? "mm-projects-sidebar" : "mm-projects-sidebar collapsed"
      }
      aria-label="Navegação da área de projetos"
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

        {expanded && (
          <div className="mm-sidebar-user">
            <div className="mm-sidebar-avatar" aria-hidden="true">
              {getInitials(user?.name || user?.email)}
            </div>

            <div className="mm-sidebar-user-copy">
              <strong>{user?.name || "Usuário Maõno"}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
        )}

        {expanded && (
          <div className="mm-sidebar-search">
            <span aria-hidden="true">⌕</span>
            <input
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Buscar"
              aria-label="Buscar projetos"
            />
          </div>
        )}
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
        {expanded && (
          <>
            <strong>Maõno Maps</strong>
            <span>{normalizeRoleLabel(user?.role)} · central geográfica</span>
          </>
        )}

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