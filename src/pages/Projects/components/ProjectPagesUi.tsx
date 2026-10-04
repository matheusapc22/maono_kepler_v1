import { MaonoSelect } from "../../../components/selection/MaonoSelect";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import type { ProjectSectionKey } from "../projects-api";
import { PROJECT_PAGE_COPY, type ProjectPageFilters } from "./project-page-query";

type IconName = "idea" | "clock" | "star" | "search" | "filter" | "plus" | "next" | "previous";
const paths: Record<IconName, string> = {
  idea: "M17 5a8 8 0 0 0-9 13c1.6 1.3 2 2.6 2 4v2h8v-2c0-1.2.3-2.2 1-3M10 28h8m-7 4h6M8 9c-2 2-2 5 0 7M23 2h4l.5 3 2 1 2.5-1 2 3-2 2v2l2 2-2 3-2.5-1-2 1-.5 3h-4l-.5-3-2-1-2.5 1-2-3 2-2v-2l-2-2 2-3 2.5 1 2-1L23 2ZM28 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  clock: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM12 7v5l3 2",
  star: "m12 3 2.75 5.57 6.15.9-4.45 4.33 1.05 6.12L12 17.03l-5.5 2.89 1.05-6.12L3.1 9.47l6.15-.9L12 3Z",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  filter: "M4 4h16l-6 7v8l-4 2V11L4 4Z",
  plus: "M12 5v14M5 12h14",
  next: "m9 5 7 7-7 7",
  previous: "m15 5-7 7 7 7",
};
export function ProjectPageIcon({ name }: { name: IconName }) {
  return <svg className="mm-project-pages__icon" data-icon={name} viewBox={name === "idea" ? "0 0 36 36" : "0 0 24 24"} fill="none" stroke="currentColor" strokeWidth={name === "idea" ? 2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}

export function ProjectPagesHeader({ section, canCreateMap, onNewMap, onHome }: {
  section: ProjectSectionKey;
  canCreateMap: boolean;
  onNewMap: (event: MouseEvent<HTMLAnchorElement>) => void;
  onHome: () => void;
}) {
  const copy = PROJECT_PAGE_COPY[section];
  return <div className="mm-project-pages__chrome">
    <nav className="mm-project-pages__breadcrumb" aria-label="Caminho da página">
      <Link to="/projects" onClick={event => { if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onHome(); }}>Início</Link>
      <ProjectPageIcon name="next" />
      <span aria-current="page">{copy.title}</span>
    </nav>
    <header className="mm-project-pages__header">
      <div className="mm-project-pages__heading">
        <ProjectPageIcon name={copy.icon} />
        <div><h1>{copy.title}</h1><p>{copy.description}</p></div>
      </div>
      {canCreateMap ? <Link to="/maps/new/create" className="mm-project-pages__button is-primary mm-project-pages__new" onClick={onNewMap}><ProjectPageIcon name="plus" />Novo Projeto</Link> : null}
    </header>
  </div>;
}

export function ProjectPageFiltersForm({ value, disabled, onChange, onApply, onClear }: {
  value: ProjectPageFilters;
  disabled: boolean;
  onChange: (filters: ProjectPageFilters) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  return <form className="mm-project-pages__filters" aria-label="Filtros de projetos" onSubmit={event => { event.preventDefault(); onApply(); }}>
    <label className="mm-project-pages__field mm-project-pages__search">
      <span>Buscar</span><span className="mm-project-pages__search-control"><ProjectPageIcon name="search" />
        <input type="search" placeholder="Nome do projeto..." value={value.search} onChange={event => onChange({ ...value, search: event.target.value })} disabled={disabled} />
      </span>
    </label>
    <label className="mm-project-pages__field"><span>Status</span>
      <MaonoSelect value={value.status} onChange={event => onChange({ ...value, status: event.target.value as ProjectPageFilters["status"] })} disabled={disabled}>
        <option value="all">Todos os status</option><option value="active">Ativos</option><option value="inactive">Inativos</option>
      </MaonoSelect>
    </label>
    <label className="mm-project-pages__field"><span>Ordenar por</span>
      <MaonoSelect value={value.order} onChange={event => onChange({ ...value, order: event.target.value as ProjectPageFilters["order"] })} disabled={disabled}>
        <option value="recent">Mais recentes</option><option value="oldest">Mais antigos</option>
      </MaonoSelect>
    </label>
    <button type="submit" className="mm-project-pages__button is-primary" disabled={disabled}><ProjectPageIcon name="search" />Aplicar</button>
    <button type="button" className="mm-project-pages__button" onClick={onClear} disabled={disabled}><ProjectPageIcon name="filter" />Limpar filtros</button>
  </form>;
}

export function ProjectPagePagination({ visibleCount, total, page, pageCount, pageSize, disabled, onPage, onPageSize }: {
  visibleCount: number; total: number; page: number; pageCount: number; pageSize: number;
  disabled: boolean; onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  return <footer className="mm-project-pages__footer">
    <p role="status" aria-live="polite" aria-atomic="true">Exibindo {visibleCount}/{total}.</p>
    <nav className="mm-project-pages__pagination" aria-label="Paginação dos projetos">
      <label>Itens por página<MaonoSelect value={pageSize} onChange={event => onPageSize(Number(event.target.value))} disabled={disabled}>
        <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
      </MaonoSelect></label>
      <button type="button" className="mm-project-pages__button" aria-label="Página anterior" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}><ProjectPageIcon name="previous" /></button>
      <span className="mm-project-pages__current" aria-current="page" aria-label={`Página ${page} de ${pageCount}`}>{page}</span>
      <button type="button" className="mm-project-pages__button" aria-label="Próxima página" disabled={disabled || page >= pageCount} onClick={() => onPage(page + 1)}><ProjectPageIcon name="next" /></button>
    </nav>
  </footer>;
}
