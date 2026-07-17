import type { CSSProperties, HTMLAttributes } from "react";

type SkeletonProps = HTMLAttributes<HTMLSpanElement> & {
  width?: CSSProperties["width"];
  height?: CSSProperties["height"];
  radius?: CSSProperties["borderRadius"];
};

type TableSkeletonProps = {
  headers: string[];
  rows?: number;
  className?: string;
};

type CountProps = {
  count?: number;
};

export function Skeleton({
  width = "100%",
  height = "1rem",
  radius = "6px",
  className = "",
  style,
  ...props
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`mm-skeleton ${className}`.trim()}
      style={{ width, height, borderRadius: radius, ...style }}
      {...props}
    />
  );
}

export function TableSkeleton({
  headers,
  rows = 5,
  className = "",
}: TableSkeletonProps) {
  return (
    <div
      className={`mm-table-wrap mm-table-skeleton ${className}`.trim()}
      aria-hidden="true"
    >
      <table>
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, rowIndex) => (
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
    <article className="mm-project-card mm-project-skeleton" aria-hidden="true">
      <div className="mm-project-thumb">
        <Skeleton className="mm-skeleton-fill" radius={0} />
      </div>
      <div className="mm-project-card-body">
        <div className="mm-project-title-row">
          <div className="mm-skeleton-stack mm-skeleton-grow">
            <Skeleton width="68%" height={18} />
            <Skeleton width="46%" height={12} />
          </div>
          <Skeleton width={78} height={24} radius={999} />
        </div>
        <div className="mm-skeleton-stack">
          <Skeleton width="96%" height={12} />
          <Skeleton width="82%" height={12} />
        </div>
        <Skeleton width="64%" height={11} />
        <Skeleton width="100%" height={34} />
      </div>
    </article>
  );
}

export function ProjectGridSkeleton({ count = 6 }: CountProps) {
  return (
    <section
      className="mm-project-grid"
      aria-busy="true"
      aria-label="Carregando projetos"
    >
      {Array.from({ length: count }, (_, index) => (
        <ProjectCardSkeleton key={index} />
      ))}
      <span className="mm-sr-only" role="status">
        Carregando projetos autorizados.
      </span>
    </section>
  );
}

function SidebarSkeleton() {
  return (
    <aside className="mm-projects-sidebar mm-skeleton-sidebar" aria-hidden="true">
      <div className="mm-sidebar-head">
        <div className="mm-sidebar-brand-row">
          <Skeleton width={142} height={38} />
          <Skeleton width={34} height={34} radius={10} />
        </div>
        <div className="mm-sidebar-user mm-skeleton-user">
          <Skeleton width={42} height={42} radius={999} />
          <div className="mm-skeleton-stack mm-skeleton-grow">
            <Skeleton width="62%" height={13} />
            <Skeleton width="82%" height={11} />
          </div>
        </div>
        <Skeleton width="100%" height={40} radius={9} />
      </div>
      <nav className="mm-sidebar-nav">
        {Array.from({ length: 9 }, (_, index) => (
          <Skeleton
            key={index}
            width="100%"
            height={38}
            radius={10}
            className="mm-skeleton-nav-item"
          />
        ))}
      </nav>
      <div className="mm-sidebar-footer">
        <Skeleton width="58%" height={12} />
        <Skeleton width="100%" height={38} radius={10} />
      </div>
    </aside>
  );
}

export function ProjectsPageSkeleton() {
  return (
    <main className="mm-projects-page mm-skeleton-page" aria-busy="true">
      <div className="mm-projects-layout">
        <SidebarSkeleton />
        <section className="mm-projects-main">
          <header className="mm-projects-topbar">
            <div className="mm-skeleton-stack mm-skeleton-topbar-copy">
              <Skeleton width={230} height={27} />
              <Skeleton width={160} height={12} />
            </div>
            <Skeleton width={112} height={38} radius={9} />
          </header>
          <div className="mm-projects-content">
            <ProjectGridSkeleton />
          </div>
        </section>
      </div>
      <span className="mm-sr-only" role="status">
        Carregando a área de projetos.
      </span>
    </main>
  );
}

function AdminSectionSkeleton({ section }: { section?: string }) {
  if (section === "organizations") {
    return (
      <section className="mm-card mm-section-card">
        <Skeleton width={230} height={24} />
        <Skeleton width={260} height={12} />
        <TableSkeleton
          headers={["Organização", "Slug", "Pasta", "Projetos", "Usuários", "Arquivos", "Status"]}
        />
      </section>
    );
  }

  if (section === "users") {
    return (
      <section className="mm-card mm-section-card">
        <Skeleton width={220} height={24} />
        <Skeleton width={240} height={12} />
        <TableSkeleton headers={["Nome", "E-mail", "Perfil", "Projetos", "Status"]} />
      </section>
    );
  }

  if (section === "projects") {
    return (
      <section className="mm-card mm-section-card">
        <Skeleton width={190} height={24} />
        <Skeleton width={260} height={12} />
        <TableSkeleton headers={["Projeto", "Slug", "JSON", "Pasta", "Acessos", "Status"]} />
      </section>
    );
  }

  if (section === "requests") {
    return (
      <section className="mm-card mm-section-card">
        <Skeleton width={150} height={24} />
        <MetricsSkeleton count={3} />
      </section>
    );
  }

  if (section === "audit") {
    return (
      <section className="mm-card mm-section-card mm-skeleton-stack">
        <Skeleton width={120} height={24} />
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} width="100%" height={48} />
        ))}
      </section>
    );
  }

  if (section === "system") {
    return (
      <section className="mm-card mm-section-card mm-skeleton-stack">
        <Skeleton width={110} height={24} />
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
  return (
    <main className="maono-admin-page admin-page mm-skeleton-page" aria-busy="true">
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
            <Skeleton width={120} height={11} />
            <Skeleton width={240} height={28} />
            <Skeleton width={180} height={12} />
          </div>
          <div className="mm-topbar-actions">
            <Skeleton width={84} height={28} radius={999} />
            <Skeleton width={96} height={38} radius={9} />
          </div>
        </header>
        <div className="admin-content">
          <AdminSectionSkeleton section={section} />
        </div>
      </section>
      <span className="mm-sr-only" role="status">
        Carregando a área administrativa.
      </span>
    </main>
  );
}
