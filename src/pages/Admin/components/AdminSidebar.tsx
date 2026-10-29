import { Link } from "react-router";
import type { MaonoUser } from "../../../auth/session.ts";
import Logo from "../../../assets/images/Logo_Maono.png";
import { StaticLoadingText } from "../../../components/loading";
import AdminIcon, { type AdminIconName } from "./AdminIcon";

type AdminSidebarItem = { section: string; label: string; icon: AdminIconName };

type AdminSidebarProps = {
  user: MaonoUser | null;
  profileLabel: string;
  section: string;
  items: AdminSidebarItem[];
  collapsed: boolean;
  structurePending: boolean;
  onToggle: () => void;
  onSection: (section: string) => void;
  onLogout: () => void | Promise<void>;
};

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[words.length - 1][0]}`.toLocaleUpperCase("pt-BR");
  return Array.from(words[0] || "U").slice(0, 2).join("").toLocaleUpperCase("pt-BR");
}

export default function AdminSidebar({ user, profileLabel, section, items, collapsed, structurePending, onToggle, onSection, onLogout }: AdminSidebarProps) {
  const displayName = user?.name?.trim() || user?.email || "Usuário";
  const toggleLabel = collapsed ? "Expandir navegação" : "Recolher navegação";
  const groups = [
    { label: "ADMINISTRAÇÃO MAÕNO", items: items.slice(0, 4) },
    { label: "CONTROLE", items: items.slice(4) },
  ];

  return (
    <aside className="admin-rail admin-workspace-sidebar" aria-label="Área administrativa">
      <div className="admin-brand admin-workspace-brand">
        <Link to="/projects" className="admin-workspace-logo" aria-label="Maõno Maps — Projetos">
          <img className="admin-workspace-logo-image" src={Logo} alt="Maõno" />
          <img className="admin-workspace-logo-symbol" src="/images/Simbolo_Maono.png" alt="" />
        </Link>
        <button
          type="button"
          className="admin-workspace-toggle"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={!collapsed}
          aria-controls="admin-sidebar-navigation"
          onClick={onToggle}
        >
          <AdminIcon name={collapsed ? "chevron-right" : "chevron-left"} />
        </button>
      </div>

      <div className="admin-workspace-identity">
        <span className="admin-workspace-avatar" aria-hidden="true">{initials(displayName)}</span>
        <div className="admin-workspace-user">
          <strong title={displayName}>{displayName}</strong>
          <span>{profileLabel}</span>
          <span className="admin-workspace-email" title={user?.email}>{user?.email}</span>
        </div>
      </div>

      <nav id="admin-sidebar-navigation" className="admin-nav admin-workspace-nav" aria-label="Navegação administrativa">
        {groups.map(group => (
          <div className="admin-workspace-nav-group" key={group.label}>
            <h2 className="admin-workspace-nav-title"><StaticLoadingText pending={structurePending}>{group.label}</StaticLoadingText></h2>
            {group.items.map(item => (
              <button
                key={item.section}
                type="button"
                className={`admin-workspace-nav-item${section === item.section ? " active" : ""}`}
                aria-current={section === item.section ? "page" : undefined}
                aria-label={item.label}
                title={collapsed ? item.label : undefined}
                onClick={() => onSection(item.section)}
              >
                <AdminIcon name={item.icon} />
                <span className="admin-workspace-nav-label"><StaticLoadingText pending={structurePending}>{item.label}</StaticLoadingText></span>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="admin-rail-footer admin-workspace-footer">
        <p className="admin-workspace-footer-title">Maõno Maps</p>
        <Link to="/projects" className="admin-workspace-footer-action" aria-label="Voltar para Projetos" title={collapsed ? "Voltar para Projetos" : undefined}>
          <AdminIcon name="return" />
          <span><StaticLoadingText pending={structurePending}>Voltar para Projetos</StaticLoadingText></span>
        </Link>
        <button type="button" className="admin-workspace-footer-action" onClick={onLogout} aria-label="Sair" title={collapsed ? "Sair" : undefined}>
          <AdminIcon name="logout" />
          <span><StaticLoadingText pending={structurePending}>Sair</StaticLoadingText></span>
        </button>
      </div>
    </aside>
  );
}
