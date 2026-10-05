import { useEffect, useRef, useState } from "react";
import type { CSSProperties, HTMLAttributes } from "react";

import Logo from "../../assets/images/Logo_Maono.png";
import {
  DEFAULT_PROLONGED_LOADING_MS,
} from "./region-loading-policy";

import { useSkeletonCount } from "./useSkeletonCount";

type SkeletonProps = HTMLAttributes<HTMLSpanElement> & {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
  /** Visual priority only. The delay runs once when this placeholder mounts. */
  group?: number;
  onsetMs?: number;
};

type TableSkeletonProps = {
  headers: string[];
  rows?: number;
  className?: string;
  pageSize?: number;
  knownCount?: number;
  structurePending?: boolean;
};

type CountProps = {
  count?: number;
};

type LoadingStatusProps = {
  loading: boolean;
  refreshing?: boolean;
  label?: string;
  refreshingLabel?: string;
  prolongedLabel?: string;
  prolongedAfterMs?: number;
  className?: string;
  /** Disable when an existing pagination/live-region owner announces this text. */
  announce?: boolean;
  visuallyHidden?: boolean;
};

/** Keep this live region outside the subtree marked aria-busy. */
export function LoadingStatus({
  loading,
  refreshing = false,
  label = "Carregando conteúdo.",
  refreshingLabel = "Atualizando conteúdo.",
  prolongedLabel = "O carregamento continua em andamento. Aguarde mais um pouco.",
  prolongedAfterMs = DEFAULT_PROLONGED_LOADING_MS,
  className = "",
  announce = true,
  visuallyHidden = true,
}: LoadingStatusProps) {
  const [prolonged, setProlonged] = useState(false);
  useEffect(() => {
    setProlonged(false);
    if (!loading) return;
    const delay = Number.isFinite(prolongedAfterMs) ? Math.max(0, prolongedAfterMs) : DEFAULT_PROLONGED_LOADING_MS;
    const timer = window.setTimeout(() => setProlonged(true), delay);
    return () => window.clearTimeout(timer);
  }, [loading, prolongedAfterMs]);
  const isProlonged = loading && prolonged;
  return <span
    role={announce ? "status" : undefined}
    aria-live={announce ? "polite" : undefined}
    aria-atomic={announce ? true : undefined}
    className={`${isProlonged ? "mm-loading-status is-prolonged" : visuallyHidden ? "mm-sr-only" : "mm-loading-status"} ${className}`.trim()}
  >{loading ? isProlonged ? prolongedLabel : refreshing ? refreshingLabel : label : ""}</span>;
}

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius = "var(--mm-skeleton-radius)",
  group,
  onsetMs,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  return (
    <span
      className={`mm-skeleton ${className}`.trim()}
      style={{
        width,
        height,
        borderRadius: radius,
        ...(group !== undefined ? { "--mm-skeleton-group": Math.max(0, group) } : {}),
        ...(onsetMs !== undefined ? { "--mm-skeleton-activation-delay": `${Math.max(0, onsetMs)}ms` } : {}),
        ...style,
      } as CSSProperties}
      {...props}
      aria-hidden="true"
      tabIndex={-1}
      contentEditable={false}
      children={null}
    />
  );
}

/**
 * A permanent inline span lets the actual text reserve its exact font/wrapping
 * geometry. Masking is visual only: existing labels and buttons keep their one
 * accessible name, and the decorative presentation adds no focusable element.
 * Use only around text already authorized/rendered by the owning region.
 */
export function StaticLoadingText({
  pending,
  children,
  className = "",
}: {
  pending: boolean;
  children: string | number | null | undefined;
  className?: string;
}) {
  return <span
    className={`mm-static-loading-text${pending ? " is-pending" : ""} ${className}`.trim()}
    data-loading-structure={pending ? "pending" : undefined}
  >{children}</span>;
}

export function TableSkeleton({
  headers,
  rows,
  className = "",
  pageSize,
  knownCount,
  structurePending = false,
}: TableSkeletonProps) {
  const estimatedRows = useSkeletonCount({ layout: "table", pageSize, knownCount });
  const rowCount = rows ?? estimatedRows;
  return (
    <div
      className={`mm-table-wrap mm-table-skeleton ${className}`.trim()}
    >
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header} scope="col"><StaticLoadingText pending={structurePending}>{header}</StaticLoadingText></th>
            ))}
          </tr>
        </thead>
        <tbody aria-hidden="true">
          {Array.from({ length: rowCount }, (_, rowIndex) => (
            <tr key={rowIndex}>
              {headers.map((header, columnIndex) => (
                <td key={`${header}-${columnIndex}`}>
                  <Skeleton
                    width={`${52 + ((rowIndex + columnIndex) % 4) * 11}%`}
                    height={12}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MetricsSkeleton({ count = 4 }: CountProps) {
  return (
    <section className="mm-metrics-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <article className="mm-card metric mm-metric-skeleton" key={index}>
          <Skeleton width="54%" height={12} />
          <Skeleton width="34%" height={30} />
        </article>
      ))}
    </section>
  );
}

export function ProjectCardSkeleton() {
  return (
    <article
      className="mm-project-card mm-project-skeleton"
      aria-hidden="true"
    >
      <div className="mm-project-card__preview">
        <Skeleton className="mm-skeleton-fill" radius={0} />
      </div>

      <div className="mm-project-card__content">
        <header className="mm-project-card__header">
          <h2><Skeleton width="72%" height="1.28em" /></h2>
          <p className="mm-project-card__creator"><Skeleton width="48%" height="1.35em" /></p>
        </header>

        <p className="mm-project-card__description">
          <Skeleton width="100%" height=".8em" />
          <Skeleton width="84%" height=".8em" style={{ marginTop: ".3em" }} />
        </p>

        <footer className="mm-project-card__footer">
          <div className="mm-project-card__metadata">
            <span className="mm-project-card__metadata-item"><Skeleton width={70} height={12} /></span>
            <span className="mm-project-card__metadata-divider" />
            <span className="mm-project-card__metadata-item mm-project-card__metadata-slug"><Skeleton width={60} height={12} /></span>
          </div>
        </footer>
      </div>
    </article>
  );
}

export function ProjectGridSkeleton({ count, pageSize, knownCount, announce = true, className = "" }: CountProps & {
  pageSize?: number;
  knownCount?: number;
  announce?: boolean;
  className?: string;
}) {
  const regionRef = useRef<HTMLElement>(null);
  const estimatedCount = useSkeletonCount({ layout: "grid", pageSize, knownCount }, regionRef);
  return (
    <>
    <section
      ref={regionRef}
      className={`mm-project-grid ${className}`.trim()}
      aria-busy="true"
      aria-label="Carregando projetos"
    >
      {Array.from({ length: count ?? estimatedCount }, (_, index) => (
        <ProjectCardSkeleton key={index} />
      ))}
    </section>
    {announce ? <LoadingStatus loading label="Carregando projetos autorizados." /> : null}
    </>
  );
}

function ProjectsLoadingSidebar() {
  return (
    <aside
      className="mm-projects-sidebar mm-projects-loading-sidebar"
      aria-hidden="true"
    >
      <div className="mm-sidebar-head">
        <div className="mm-sidebar-brand-row">
          <div className="mm-sidebar-logo-mask">
            <img src={Logo} alt="" className="mm-sidebar-logo" />
          </div>
          <span className="mm-loading-sidebar-toggle">‹</span>
        </div>
        <div className="mm-loading-sidebar-user">
          <span className="mm-loading-static-block mm-loading-sidebar-avatar" />
          <div className="mm-loading-sidebar-user-copy">
            <span className="mm-loading-static-block" />
            <span className="mm-loading-static-block short" />
          </div>
        </div>
        <span className="mm-loading-static-block mm-loading-sidebar-search" />
      </div>
      <nav className="mm-loading-sidebar-nav">
        {Array.from({ length: 9 }, (_, index) => (
          <span
            key={index}
            className="mm-loading-static-block mm-loading-sidebar-item"
          />
        ))}
      </nav>
      <div className="mm-loading-sidebar-footer">
        <span className="mm-loading-static-block mm-loading-sidebar-footer-copy" />
        <span className="mm-loading-static-block mm-loading-sidebar-footer-action" />
      </div>
    </aside>
  );
}

// A route fallback waits for real module/auth availability. It never starts a
// second presentation clock or reveals a title that the mounted route remasks.
export function ProjectsPageSkeleton() {
  return (
    <>
    <main className="mm-projects-page mm-skeleton-page">
      <div className="mm-projects-layout">
        <ProjectsLoadingSidebar />
        <section className="mm-projects-main">
          <header className="mm-projects-topbar">
            <div className="mm-skeleton-stack mm-skeleton-topbar-copy">
              <h1><StaticLoadingText pending>Projetos</StaticLoadingText></h1>
              <Skeleton width={160} height={12} />
            </div>
            <Skeleton width={112} height={38} radius={9} />
          </header>
          <div className="mm-projects-content">
            <ProjectGridSkeleton announce={false} />
          </div>
        </section>
      </div>
    </main>
    <LoadingStatus loading label="Carregando a área de projetos." />
    </>
  );
}

function AdminSectionSkeleton({ section }: { section?: string }) {
  if (section === "organizations") {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending>Organizações</StaticLoadingText></h2>
        <Skeleton width={260} height={12} />
        <TableSkeleton
          structurePending
          headers={["Organização", "Slug", "Pasta", "Projetos", "Usuários", "Arquivos", "Status"]}
        />
      </section>
    );
  }

  if (section === "users") {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending>Usuários</StaticLoadingText></h2>
        <Skeleton width={240} height={12} />
        <TableSkeleton structurePending headers={["Nome", "E-mail", "Perfil", "Projetos", "Status"]} />
      </section>
    );
  }

  if (section === "projects") {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending>Projetos</StaticLoadingText></h2>
        <Skeleton width={260} height={12} />
        <TableSkeleton structurePending headers={["Projeto", "Slug", "JSON", "Pasta", "Acessos", "Status"]} />
      </section>
    );
  }

  if (section === "requests") {
    return (
      <section className="mm-card mm-section-card">
        <h2><StaticLoadingText pending>Solicitações</StaticLoadingText></h2>
        <MetricsSkeleton count={3} />
      </section>
    );
  }

  if (section === "audit") {
    return (
      <section className="mm-card mm-section-card mm-skeleton-stack">
        <h2><StaticLoadingText pending>Auditoria</StaticLoadingText></h2>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} width="100%" height={48} />
        ))}
      </section>
    );
  }

  if (section === "system") {
    return (
      <section className="mm-card mm-section-card mm-skeleton-stack">
        <h2><StaticLoadingText pending>Sistema</StaticLoadingText></h2>
        <Skeleton width="72%" height={12} />
        <Skeleton width="100%" height={112} />
      </section>
    );
  }

  return (
    <>
      <MetricsSkeleton count={4} />
      <section className="admin-command-grid" aria-hidden="true">
        {Array.from({ length: 3 }, (_, index) => (
          <article className="mm-card mm-section-card mm-skeleton-stack" key={index}>
            <Skeleton width="58%" height={20} />
            <Skeleton width="88%" height={12} />
            <Skeleton width={130} height={36} />
          </article>
        ))}
      </section>
    </>
  );
}

export function AdminPageSkeleton({ section = "overview" }: { section?: string }) {
  const titles: Record<string, string> = {
    overview: "Painel Admin",
    organizations: "Gestão de Organizações",
    users: "Usuários e Permissões",
    projects: "Projetos e Mapas",
    requests: "Solicitações",
    audit: "Auditoria",
    system: "Sistema",
  };
  return (
    <>
    <main className="maono-admin-page admin-page mm-skeleton-page">
      <aside className="admin-rail mm-skeleton-admin-rail" aria-hidden="true">
        <div className="admin-brand">
          <Skeleton width={38} height={38} radius={9} />
          <div className="mm-skeleton-stack mm-skeleton-grow">
            <Skeleton width="68%" height={13} />
            <Skeleton width="44%" height={11} />
          </div>
        </div>
        <nav className="admin-nav">
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} width="100%" height={38} radius={9} />
          ))}
        </nav>
        <div className="admin-rail-footer mm-skeleton-stack">
          <Skeleton width="100%" height={38} radius={9} />
          <Skeleton width="100%" height={38} radius={9} />
        </div>
      </aside>
      <section className="admin-main">
        <header className="mm-projects-topbar admin-topbar">
          <div className="mm-skeleton-stack mm-skeleton-topbar-copy">
            <p className="mm-eyebrow"><StaticLoadingText pending>Administração Maõno</StaticLoadingText></p>
            <h1><StaticLoadingText pending>{titles[section] ?? titles.overview}</StaticLoadingText></h1>
            <p><StaticLoadingText pending>Acesso administrativo.</StaticLoadingText></p>
          </div>
          <div className="mm-topbar-actions">
            <Skeleton width={84} height={28} radius={999} />
            <Skeleton width={96} height={38} radius={9} />
          </div>
        </header>
        <div className="admin-content" aria-busy="true">
          <AdminSectionSkeleton section={section} />
        </div>
      </section>
    </main>
    <LoadingStatus loading label="Carregando a área administrativa." />
    </>
  );
}
