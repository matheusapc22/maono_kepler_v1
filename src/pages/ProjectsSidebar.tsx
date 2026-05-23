import React, { useState } from "react";
import { Link } from "react-router";
import Logo from "../assets/images/Logo_Maono.png";
import type { MaonoUser } from "../auth/session";

export type ProjectSidebarSection = "recent" | "all";

type ProjectsSidebarProps = {
  user: MaonoUser | null;
  activeProjectsCount: number;
  searchQuery: string;
  sidebarSection: ProjectSidebarSection;
  onSearchQueryChange: (value: string) => void;
  onSidebarSectionChange: (section: ProjectSidebarSection) => void;
  onLogout: () => void | Promise<void>;
};

type IconProps = {
  className?: string;
};

type SidebarIconButtonProps = {
  label: string;
  icon: React.ReactNode;
  expanded: boolean;
  active?: boolean;
  count?: number;
  onClick?: () => void;
};

function getInitials(nameOrEmail?: string) {
  const value = String(nameOrEmail || "M").trim();
  const [first = "M", second = ""] = value.replace(/@.*/, "").split(/[\s._-]+/);
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function HomeIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 7.75v4.7l3.15 2.05" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GridIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.75 4.75h5.5v5.5h-5.5v-5.5ZM13.75 4.75h5.5v5.5h-5.5v-5.5ZM4.75 13.75h5.5v5.5h-5.5v-5.5ZM13.75 13.75h5.5v5.5h-5.5v-5.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.75" cy="10.75" r="6" stroke="currentColor" strokeWidth="1.8" />
      <path d="m15.25 15.25 4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3.75 12s3-5.25 8.25-5.25S20.25 12 20.25 12s-3 5.25-8.25 5.25S3.75 12 3.75 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="2.25" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EditIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 19h4.25L18.5 9.75a2.5 2.5 0 0 0-3.54-3.54L5.7 15.46 5 19Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m13.75 7.4 2.85 2.85" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function CrownIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m4.75 8 4.1 3.55L12 6l3.15 5.55L19.25 8l-1.15 9.25H5.9L4.75 8Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M6.5 20h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SettingsIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" stroke="currentColor" strokeWidth="1.8" />
      <path d="M18.55 13.15c.06-.38.06-.92 0-1.3l1.65-1.25-1.8-3.1-1.95.8a7.5 7.5 0 0 0-1.1-.65L15.1 5.5H8.9l-.25 2.15c-.38.18-.75.4-1.1.65l-1.95-.8-1.8 3.1 1.65 1.25c-.06.38-.06.92 0 1.3L3.8 14.4l1.8 3.1 1.95-.8c.35.25.72.47 1.1.65l.25 2.15h6.2l.25-2.15c.38-.18.75-.4 1.1-.65l1.95.8 1.8-3.1-1.65-1.25Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function LogoutIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M10 5H6.75A1.75 1.75 0 0 0 5 6.75v10.5C5 18.22 5.78 19 6.75 19H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M14 8.25 17.75 12 14 15.75M17.25 12H9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CollapseIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8 6 4 12l4 6M20 6l-4 6 4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ExpandIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m4 6 4 6-4 6M16 6l4 6-4 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SidebarIconButton({ label, icon, expanded, active = false, count, onClick }: SidebarIconButtonProps) {
  const content = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-current">
        {icon}
      </span>
      {expanded && (
        <span className="min-w-0 flex-1 truncate text-left">
          {label}
        </span>
      )}
      {expanded && typeof count === "number" && (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
          {count}
        </span>
      )}
    </>
  );

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={
        active
          ? "flex w-full items-center gap-2 rounded-2xl bg-rose-50 px-2 py-2 font-semibold text-slate-950"
          : "flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
      }
    >
      {content}
    </button>
  );
}

function SidebarSectionTitle({ children, expanded }: { children: React.ReactNode; expanded: boolean }) {
  if (!expanded) {
    return <div className="my-3 h-px bg-slate-200" />;
  }

  return <div className="mb-2 mt-5 px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{children}</div>;
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
  const workspaceName = user?.name ? `${user.name.split(" ")[0]}'s Workspace` : "Maõno Workspace";

  return (
    <aside
      className={
        expanded
          ? "flex w-[296px] shrink-0 flex-col border-r border-slate-200 bg-[#fafafa] transition-all duration-300"
          : "flex w-20 shrink-0 flex-col border-r border-slate-200 bg-[#fafafa] transition-all duration-300"
      }
    >
      <div className={expanded ? "flex h-20 items-center justify-between px-7" : "flex h-20 flex-col items-center justify-center gap-2 px-3"}>
        {expanded ? (
          <img src={Logo} alt="Maõno" className="h-11 w-auto object-contain" />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-black text-white">M</div>
        )}
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:bg-slate-100 hover:text-slate-950"
          title={expanded ? "Recolher barra lateral" : "Expandir barra lateral"}
          aria-label={expanded ? "Recolher barra lateral" : "Expandir barra lateral"}
        >
          {expanded ? <CollapseIcon className="h-4 w-4" /> : <ExpandIcon className="h-4 w-4" />}
        </button>
      </div>

      <div className={expanded ? "px-7 pb-7 pt-2" : "px-3 pb-5 pt-2"}>
        <div className={expanded ? "flex items-center gap-3 rounded-2xl px-1 py-2" : "flex flex-col items-center gap-2 rounded-2xl py-2"}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            {getInitials(user?.name || user?.email)}
          </div>
          {expanded && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-950">{workspaceName}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 px-4 text-sm">
        <SidebarSectionTitle expanded={expanded}>Mapas</SidebarSectionTitle>
        <div className="space-y-1">
          <SidebarIconButton
            label="Início"
            icon={<HomeIcon />}
            expanded={expanded}
            onClick={() => onSidebarSectionChange("recent")}
          />
          <SidebarIconButton
            label="Recentes"
            icon={<ClockIcon />}
            expanded={expanded}
            active={sidebarSection === "recent"}
            count={activeProjectsCount}
            onClick={() => onSidebarSectionChange("recent")}
          />
          <SidebarIconButton
            label="Todos os projetos"
            icon={<GridIcon />}
            expanded={expanded}
            active={sidebarSection === "all"}
            count={activeProjectsCount}
            onClick={() => onSidebarSectionChange("all")}
          />
        </div>

        <div className="mt-2">
          {expanded ? (
            <label className="flex items-center gap-2 rounded-2xl px-2 py-2 text-slate-700 transition hover:bg-slate-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-500">
                <SearchIcon />
              </span>
              <input
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder="Buscar"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-500"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Buscar"
              aria-label="Buscar"
              className="flex w-full items-center justify-center rounded-2xl px-2 py-2 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl">
                <SearchIcon />
              </span>
            </button>
          )}
        </div>

        <SidebarSectionTitle expanded={expanded}>Acessos</SidebarSectionTitle>
        <div className="space-y-1">
          <SidebarIconButton label="Visualização" icon={<EyeIcon />} expanded={expanded} />
          <SidebarIconButton label="Edição" icon={<EditIcon />} expanded={expanded} />
          <SidebarIconButton label="Proprietário" icon={<CrownIcon />} expanded={expanded} />
        </div>

        <SidebarSectionTitle expanded={expanded}>Conta</SidebarSectionTitle>
        <div className="space-y-1">
          {user?.role === "admin" && (
            <Link
              to="/admin"
              title="Painel Admin"
              aria-label="Painel Admin"
              className="flex items-center gap-2 rounded-2xl px-2 py-2 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
                <SettingsIcon />
              </span>
              {expanded && <span className="min-w-0 flex-1 truncate">Painel Admin</span>}
            </Link>
          )}
          <button
            type="button"
            onClick={onLogout}
            title="Sair"
            aria-label="Sair"
            className="flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
              <LogoutIcon />
            </span>
            {expanded && <span className="min-w-0 flex-1 truncate text-left">Sair</span>}
          </button>
        </div>
      </nav>

      {expanded && (
        <div className="m-5 rounded-2xl bg-blue-50 p-5 text-sm text-blue-900">
          <p className="font-bold">Maõno Maps</p>
          <p className="mt-2 leading-5 text-blue-700">
            Acesse os mapas liberados para sua conta e acompanhe as últimas atualizações dos projetos.
          </p>
        </div>
      )}
    </aside>
  );
};

export default ProjectsSidebar;
